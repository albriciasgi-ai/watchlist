import React, { useEffect, useRef, useState } from 'react';
import { THEME } from '@app1/components/uiTheme.js';
import { linesFor, subscribeBook } from './botBook.js';
import { fmtQty } from './ladderLogic.js';
import { fmtUsd } from '@app1/components/sustainedLevels.js';
import { getJson, postJson } from './api.js';
import { onAnyDrawings, sendDrawings } from './tabs.js';
import { tapeLine, tapeLineId, withPendingLine, firmLine, removeLine, lineState, restyle, firmLines, cleanStyle, shortLabel,
  TAPE_STYLE_KEY } from './tapeLines.js';

/**
 * Cinta de operaciones grandes (14/11/2026), a la derecha del ladder en la pestaña "Mapa". Pedido del usuario, como el
 * Smart Tape de ATAS: los trades del mismo instante y lado son una orden, y se muestran solo las grandes (de fábrica,
 * el 1% más grande de los últimos 30 minutos). Sale de los trades que ya recibe la suite (/api/book/tape).
 * - Verde ▲ compra agresiva, rojo ▼ venta agresiva; en negrita las de 3 veces el mínimo o más.
 * - Una orden que cruzó varios precios dice el rango ("65,586.5→65,576.2"): un barrido. Al pasar el mouse, cuánto cruzó.
 * - Resaltada si tocó el precio de una Limit tuya.
 * - Arriba, lo comprado y lo vendido a mercado en los últimos 30 s.
 * - Clic en una orden (14/11, pedido del usuario): una línea horizontal en el gráfico, a su precio promedio y con su
 *   información, provisional (punteada) hasta "Dejar en firme"; "Borrar" la quita. Es un dibujo de la moneda: se ve en
 *   el mapa, el gráfico principal y la Watchlist. Una provisional por moneda: otro clic la reemplaza.
 * - "En firme (N)": todas las líneas en firme de la moneda, aunque su orden ya salió de la cinta (guarda 30 minutos);
 *   solo se borran a mano. En el gráfico principal una línea en firme también se elige para el análisis del trade.
 * - ⚙: estilo de las líneas de la cinta (grosor, trazo, opacidad y texto), para todas; de fábrica, discretas.
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
  const [lineStates, setLineStates] = useState({});   // id de la línea -> 'pending' | 'firm'
  const [selected, setSelected] = useState(null);
  const [lineError, setLineError] = useState(null);
  const [firm, setFirm] = useState([]);
  const [showFirm, setShowFirm] = useState(false);
  const [showStyle, setShowStyle] = useState(false);
  const [style, setStyle] = useState(() => {
    try { return cleanStyle(JSON.parse(localStorage.getItem(TAPE_STYLE_KEY)) || {}); } catch { return cleanStyle({}); }
  });
  const styleRef = useRef(style);
  styleRef.current = style;

  // Las líneas de la cinta que ya están en los dibujos de la moneda (también si cambian en otra pestaña)
  // Solo cambia el estado si cambió algo: cada aviso de dibujos (de esta y de las otras pestañas) volvía a dibujar la cinta
  const readStates = (shapes) => {
    const out = {};
    for (const sh of shapes || []) if (sh?.tape && typeof sh.id === 'string') out[sh.id] = lineState([sh], sh.id);
    setLineStates(prev => JSON.stringify(prev) === JSON.stringify(out) ? prev : out);
    const nextFirm = firmLines(shapes);
    setFirm(prev => (prev.length === nextFirm.length && prev.every((sh, i) => sh.id === nextFirm[i].id && sh.label === nextFirm[i].label
      && sh.price === nextFirm[i].price && sh.style?.color === nextFirm[i].style?.color) ? prev : nextFirm));
  };
  // Otro estilo: se guarda y se aplica a todas las líneas de la cinta de esta moneda
  const changeStyle = (patch) => {
    const next = cleanStyle({ ...styleRef.current, ...patch });
    setStyle(next);
    try { localStorage.setItem(TAPE_STYLE_KEY, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
    // la opacidad se arrastra: se guardan los dibujos cuando se deja de mover
    clearTimeout(styleTimer.current);
    styleTimer.current = setTimeout(() => changeLines(list => restyle(list, styleRef.current, fmtQty)), 300);
  };
  const styleTimer = useRef(null);
  useEffect(() => {
    setSelected(null);
    getJson(`/api/drawings/${encodeURIComponent(symbol)}`).then(d => readStates(d.shapes)).catch(() => {});
    return onAnyDrawings((sym, shapes) => { if (sym === symbol) readStates(shapes); });
  }, [symbol]);

  // Cambia los dibujos de la moneda: los lee, aplica el cambio, los guarda y avisa a las otras pestañas
  const changeLines = async (change) => {
    setLineError(null);
    try {
      const d = await getJson(`/api/drawings/${encodeURIComponent(symbol)}`);
      const list = change(d.shapes || []);
      await postJson(`/api/drawings/${encodeURIComponent(symbol)}`, { shapes: list, interval: d.interval || '' });
      sendDrawings(symbol, list);
      readStates(list);
    } catch (e) {
      setLineError(`No se pudo cambiar la línea: ${e.message}`);
    }
  };
  const showOnChart = (o) => {
    const id = tapeLineId(symbol, o);
    setSelected(id);
    if (lineStates[id]) return;   // ya está en el gráfico: solo se elige
    const color = o.side === 'buy' ? (THEME.up || '#089981') : (THEME.down || '#F23645');
    changeLines(list => withPendingLine(list, tapeLine(symbol, o, color, true, fmtQty, styleRef.current)));
  };

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
        <button type="button" className={`suite-btn ${showStyle ? 'active' : ''}`} style={{ padding: '0 6px' }} onClick={() => setShowStyle(v => !v)}
          title="Estilo de las líneas de la cinta en el gráfico">⚙</button>
      </div>
      {showStyle && (
        <div style={{ padding: '4px 6px 6px', borderTop: '1px solid var(--t-line, #d0d4da)', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 6px', alignItems: 'center' }}>
          <span className="wl-muted">Grosor</span>
          <select className="suite-select" value={style.width} onChange={(e) => changeStyle({ width: Number(e.target.value) })} aria-label="Grosor de las líneas">
            {[1, 2, 3, 4].map(w => <option key={w} value={w}>{w} px</option>)}
          </select>
          <span className="wl-muted">Trazo</span>
          <select className="suite-select" value={style.dashed ? 'dashed' : 'solid'} onChange={(e) => changeStyle({ dashed: e.target.value === 'dashed' })} aria-label="Trazo de las líneas">
            <option value="solid">Continua</option>
            <option value="dashed">Punteada</option>
          </select>
          <span className="wl-muted">Opacidad</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="range" min={15} max={100} step={5} value={Math.round(style.opacity * 100)} style={{ width: 90 }} aria-label="Opacidad de las líneas"
              onChange={(e) => changeStyle({ opacity: Number(e.target.value) / 100 })} />
            <span className="wl-muted">{Math.round(style.opacity * 100)}%</span>
          </span>
          <span className="wl-muted">Texto</span>
          <span style={{ display: 'flex', gap: 4 }}>
            <select className="suite-select" value={style.label} onChange={(e) => changeStyle({ label: e.target.value })} aria-label="Texto de las líneas">
              <option value="short">Corto</option>
              <option value="full">Completo</option>
              <option value="none">Sin texto</option>
            </select>
            <select className="suite-select" value={style.size} disabled={style.label === 'none'} onChange={(e) => changeStyle({ size: Number(e.target.value) })} aria-label="Tamaño del texto">
              {[8, 9, 10, 11, 12, 13, 14].map(z => <option key={z} value={z}>{z} px</option>)}
            </select>
          </span>
        </div>
      )}
      {firm.length > 0 && (
        <div style={{ padding: '2px 6px', borderTop: '1px solid var(--t-line, #d0d4da)' }}>
          <button type="button" className="suite-btn" style={{ padding: '0 6px', fontSize: 11 }} onClick={() => setShowFirm(v => !v)}
            title="Las líneas de la cinta que dejaste en firme en esta moneda: quedan hasta que las borres">
            En firme ({firm.length}) {showFirm ? '▴' : '▾'}
          </button>
          {showFirm && firm.map(sh => (
            <div key={sh.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
              <span style={{ flex: 1, color: sh.style?.color }}>{shortLabel(sh.tape)}{' · '}{Number(sh.price.toPrecision(8)).toLocaleString('en-US')}</span>
              <button type="button" className="suite-btn" style={{ padding: '0 6px', fontSize: 11 }}
                onClick={() => changeLines(list => removeLine(list, sh.id))} title="Quitar la línea del gráfico">Borrar</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ padding: '0 6px 4px' }} title="Lo comprado y lo vendido a mercado en los últimos 30 segundos, de todos los tamaños">
        <div className="wl-muted">30 s: <span style={{ color: up }}>compra {fmtUsd(buy)}</span> · <span style={{ color: down }}>venta {fmtUsd(sell)}</span></div>
        {total > 0 && (
          <div style={{ display: 'flex', height: 4, marginTop: 2 }}>
            <div style={{ width: `${(100 * buy) / total}%`, background: up }} />
            <div style={{ flex: 1, background: down }} />
          </div>
        )}
      </div>
      {/* sin desborde de lado (16/11): con los botones de la fila elegida la lista medía 14 px más que la cinta, salía
          una barra horizontal y, con pocas filas, las barras aparecían y desaparecían: la cinta titilaba */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', borderTop: '1px solid var(--t-line, #d0d4da)' }}>
        {error && <div className="wl-muted" style={{ padding: 6 }}>Cinta: {error}</div>}
        {lineError && <div className="wl-muted" style={{ padding: 6 }}>{lineError}</div>}
        {!error && data?.note && <div className="wl-muted" style={{ padding: 6 }}>{data.note}</div>}
        {!error && data && !data.note && !data.orders.length && <div className="wl-muted" style={{ padding: 6 }}>Ninguna orden de ese tamaño en 30 minutos</div>}
        {(data?.orders || []).map((o) => {
          const color = o.side === 'buy' ? up : down;
          const strong = thr > 0 && o.usd >= 3 * thr;
          const mine = limits.some(p => p >= o.lo - 1e-9 && p <= o.hi + 1e-9);
          const range = o.levels > 1 ? `${priceText(o.p0)}→${priceText(o.p1)}` : priceText(o.p0);
          const id = tapeLineId(symbol, o);
          const state = lineStates[id];
          return (
            <div key={`${o.t}-${o.side}-${o.p0}-${o.qty}`} onClick={() => showOnChart(o)}
              title={`${o.trades} trades${o.levels > 1 ? ` · cruzó ${priceText(o.hi - o.lo)} (${o.levels} ticks)` : ''}${mine ? ' · tocó el precio de tu Limit' : ''} · clic: verla en el gráfico`}
              style={{ padding: '2px 6px', cursor: 'pointer', fontWeight: strong ? 700 : 400,
                background: mine || selected === id ? 'var(--t-accent-soft, rgba(41,98,255,0.12))' : undefined,
                borderBottom: '1px solid var(--t-line, #eee)' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span className="wl-muted" style={{ width: 50, flexShrink: 0 }}>{timeText(o.t)}</span>
              <span style={{ color, width: 10, flexShrink: 0 }}>{o.side === 'buy' ? '▲' : '▼'}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {range}
              </span>
              <span style={{ color, width: 38, textAlign: 'right', flexShrink: 0 }}>{fmtQty(o.qty)}</span>
              <span style={{ color, width: 38, textAlign: 'right', flexShrink: 0 }}>{fmtUsd(o.usd)}</span>
            </div>
            {state && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', margin: '2px 0 1px 56px', fontWeight: 400 }}
                onClick={(e) => e.stopPropagation()}>
                <span className="wl-muted" title={state === 'pending' ? 'En el gráfico, provisional: punteada' : 'En el gráfico, en firme'}>
                  {state === 'pending' ? 'Provisional' : '✓ En firme'}
                </span>
                {state === 'pending' && (
                  <button type="button" className="suite-btn" style={{ padding: '0 6px', fontSize: 11, whiteSpace: 'nowrap' }}
                    onClick={() => changeLines(list => firmLine(list, id, styleRef.current, fmtQty))} title="La línea queda como referencia hasta que la borres">Dejar en firme</button>
                )}
                <button type="button" className="suite-btn" style={{ padding: '0 6px', fontSize: 11, whiteSpace: 'nowrap' }}
                  onClick={() => changeLines(list => removeLine(list, id))} title="Quitar la línea del gráfico">Borrar</button>
              </div>
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
