import React, { useCallback, useEffect, useRef, useState } from 'react';
import { THEME } from '@app1/components/uiTheme.js';
import { linesFor, subscribeBook } from './botBook.js';
import { LADDER_STEPS, LADDER_WINDOWS, fmtQty, priceDigits, followCenter, wallThreshold, ladderMarks, rowOf, stepLabel, stepFor,
  pickSide, startQueue, queueNow, queueText } from './ladderLogic.js';
import { makePick, sendPick } from './ladderPick.js';
import { PLAN_MODES, PLAN_NAMES, emptyPlan, planClick, planReady, planBox, withBox, planSummary } from './ladderPlan.js';
import { getJson, postJson } from './api.js';
import { sendDrawings } from './tabs.js';

/**
 * Price ladder (14/11/2026), en la pestaña "Mapa", a la derecha del mapa. Pedido del usuario: el ladder en la misma
 * pestaña del mapa. Sale del libro que la suite ya tiene en memoria (/api/book/ladder): no abre otra conexión a Bybit.
 * Columnas, por precio: lo agregado o retirado en compra en los últimos 5 s, compra en espera, precio, venta en espera,
 * lo agregado o retirado en venta, y lo negociado en la ventana elegida (compra agresiva y venta agresiva).
 * Marca tus posiciones (entrada, SL, TP, liquidación) y tus órdenes.
 * Para ejecutar (14/11/2026): un clic en Compra pone una Limit de compra a ese precio en el panel de trading (en Venta,
 * de venta); enviarla sigue pidiendo la confirmación del panel. Con "Stop" y "Objetivo" se eligen también esos precios
 * (los botones avanzan solos: entrada → stop → objetivo); con los tres, el ladder dibuja la caja TP/SL de la moneda y el
 * panel la usa. Tus Limit llevan la cola estimada: lo que tienes delante,
 * en un rango (lo retirado no se sabe si estaba delante o detrás).
 */

export const LADDER_WIDTH = 362;   // las columnas suman 356, mas el borde
const ROW_H = 17;
const HEAD_H = 20;
const FOOT_H = 50;
const QUEUE_KEY = 'suite_ladder_queue';   // cola de cada Limit tuya, por orden: sobrevive a recargar la pestaña
const NOTICE_MS = 8000;
const POLL_MS = 250;
const HIDDEN_POLL_MS = 2000;
// x y ancho de cada columna
const COLS = [
  { key: 'db', title: 'Δ 5 s', w: 46 },
  { key: 'bid', title: 'Compra', w: 70 },
  { key: 'price', title: 'Precio', w: 78 },
  { key: 'ask', title: 'Venta', w: 70 },
  { key: 'da', title: 'Δ 5 s', w: 46 },
  { key: 'traded', title: 'Negoc.', w: 46 },
];
let x = 0;
for (const c of COLS) { c.x = x; x += c.w; }

const rgba = (rgb, a) => `rgba(${rgb}, ${a})`;

function markColor(side) {
  if (side === 'plan') return THEME.accent || '#2962FF';
  if (side === 'buy') return THEME.up || '#089981';
  if (side === 'sell') return THEME.down || '#F23645';
  if (side === 'risk') return THEME.down || '#F23645';
  return THEME.accent || '#2962FF';
}

function draw(canvas, data, error, hover, marks, extra = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const font = THEME.font || '"Segoe UI", system-ui, sans-serif';
  const text = THEME.text || '#1F2328';
  const muted = THEME.textMuted || '#5F6670';
  const grid = THEME.grid || '#E4E7EC';
  const upRgb = THEME.upRgb || '8, 153, 129';
  const downRgb = THEME.downRgb || '242, 54, 69';
  ctx.fillStyle = THEME.chartBg || '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';

  // encabezado
  ctx.font = `600 11px ${font}`;
  ctx.fillStyle = muted;
  ctx.textAlign = 'center';
  for (const c of COLS) ctx.fillText(c.title, c.x + c.w / 2, HEAD_H / 2);
  ctx.fillStyle = grid;
  ctx.fillRect(0, HEAD_H - 1, w, 1);

  if (!data) {
    ctx.font = `12px ${font}`;
    ctx.fillStyle = muted;
    ctx.textAlign = 'left';
    const msg = error ? `Ladder: ${error}` : 'Ladder: cargando el libro…';
    ctx.fillText(msg.length > 52 ? `${msg.slice(0, 51)}…` : msg, 8, HEAD_H + 16);
    return;
  }

  const rows = data.rows;
  const n = rows.length;
  const step = data.step;
  const top = rows[0][0];
  const digits = priceDigits(step, data.tick);
  const maxBook = Math.max(1e-12, ...rows.map(r => Math.max(r[1], r[2])));
  const maxTraded = Math.max(1e-12, ...rows.map(r => r[3] + r[4]));
  const maxDelta = Math.max(1e-12, ...rows.map(r => Math.max(Math.abs(r[5] || 0), Math.abs(r[6] || 0))));
  const wall = wallThreshold(rows);
  const bestBidRow = rowOf(data.best_bid, top, step, n);
  const bestAskRow = rowOf(data.best_ask, top, step, n);
  const lastRow = data.last ? rowOf(data.last, top, step, n) : -2;
  const col = Object.fromEntries(COLS.map(c => [c.key, c]));

  for (let i = 0; i < n; i++) {
    const [price, bid, ask, buy, sell, db, da] = rows[i];
    const y = HEAD_H + i * ROW_H;
    if (y > h - FOOT_H) break;
    const mid = y + ROW_H / 2;
    if (i === hover) {
      ctx.fillStyle = THEME.hover || 'rgba(0,0,0,0.05)';
      ctx.fillRect(0, y, w, ROW_H);
    }
    // compra: barra desde el precio hacia la izquierda
    if (bid > 0) {
      const c = col.bid;
      const bw = Math.max(1, (bid / maxBook) * (c.w - 2));
      ctx.fillStyle = rgba(upRgb, i === bestBidRow ? 0.45 : bid >= wall ? 0.4 : 0.2);
      ctx.fillRect(c.x + c.w - bw, y + 1, bw, ROW_H - 2);
      ctx.font = `${bid >= wall ? '700 ' : ''}11px ${font}`;
      ctx.fillStyle = text;
      ctx.textAlign = 'right';
      ctx.fillText(fmtQty(bid), c.x + c.w - 3, mid);
    }
    // venta: barra desde el precio hacia la derecha
    if (ask > 0) {
      const c = col.ask;
      const bw = Math.max(1, (ask / maxBook) * (c.w - 2));
      ctx.fillStyle = rgba(downRgb, i === bestAskRow ? 0.45 : ask >= wall ? 0.4 : 0.2);
      ctx.fillRect(c.x, y + 1, bw, ROW_H - 2);
      ctx.font = `${ask >= wall ? '700 ' : ''}11px ${font}`;
      ctx.fillStyle = text;
      ctx.textAlign = 'left';
      ctx.fillText(fmtQty(ask), c.x + 3, mid);
    }
    // agregado (+) o retirado (−) en los últimos segundos
    for (const [v, c] of [[db, col.db], [da, col.da]]) {
      if (!v) continue;
      const a = Math.min(1, Math.abs(v) / maxDelta);
      ctx.fillStyle = rgba(v > 0 ? upRgb : downRgb, 0.08 + 0.25 * a);
      ctx.fillRect(c.x + 1, y + 1, c.w - 2, ROW_H - 2);
      ctx.font = `10px ${font}`;
      ctx.fillStyle = v > 0 ? (THEME.upText || text) : (THEME.downText || text);
      ctx.textAlign = 'center';
      ctx.fillText(`${v > 0 ? '+' : ''}${fmtQty(v)}`, c.x + c.w / 2, mid);
    }
    // negociado: venta agresiva (roja) y compra agresiva (verde), una tras otra
    if (buy + sell > 0) {
      const c = col.traded;
      const total = ((buy + sell) / maxTraded) * (c.w - 4);
      const sw = total * (sell / (buy + sell));
      ctx.fillStyle = rgba(downRgb, 0.35);
      ctx.fillRect(c.x + 2, y + 2, sw, ROW_H - 4);
      ctx.fillStyle = rgba(upRgb, 0.35);
      ctx.fillRect(c.x + 2 + sw, y + 2, total - sw, ROW_H - 4);
      ctx.font = `10px ${font}`;
      ctx.fillStyle = text;
      ctx.textAlign = 'right';
      ctx.fillText(fmtQty(buy + sell), c.x + c.w - 2, mid);
    }
    // precio
    const c = col.price;
    if (i === lastRow) {
      ctx.fillStyle = THEME.accentSoft || 'rgba(41,98,255,0.12)';
      ctx.fillRect(c.x, y, c.w, ROW_H);
      ctx.strokeStyle = THEME.accent || '#2962FF';
      ctx.lineWidth = 1;
      ctx.strokeRect(c.x + 0.5, y + 0.5, c.w - 1, ROW_H - 1);
    }
    ctx.font = `${i === lastRow ? '700 ' : ''}11px ${font}`;
    ctx.fillStyle = i === lastRow ? text : (price >= data.best_ask ? (THEME.downText || text) : price <= data.best_bid ? (THEME.upText || text) : muted);
    ctx.textAlign = 'center';
    ctx.fillText(price.toFixed(digits), c.x + c.w / 2, mid);
  }
  // separadores de columna
  ctx.fillStyle = grid;
  for (const c of COLS.slice(1)) ctx.fillRect(c.x, HEAD_H, 1, h - HEAD_H - FOOT_H);

  // tus posiciones y órdenes, y la entrada, el stop y el objetivo elegidos aquí: etiqueta a la izquierda de su fila, o en
  // el borde si quedan fuera
  const visibleRows = Math.min(n, Math.floor((h - FOOT_H - HEAD_H) / ROW_H));
  const used = new Map();
  const plan = extra.plan || {};
  const planMarks = [
    plan.entry > 0 && { price: plan.entry, text: `Plan entrada${plan.side ? (plan.side === 'long' ? ' compra' : ' venta') : ''}`, side: 'plan' },
    plan.sl > 0 && { price: plan.sl, text: 'Plan stop', side: 'risk' },
    plan.tp > 0 && { price: plan.tp, text: 'Plan objetivo', side: 'target' },
  ].filter(Boolean);
  for (const m of [...planMarks, ...marks]) {
    let r = rowOf(m.price, top, step, n);
    let arrow = '';
    if (r < 0) { r = 0; arrow = '↑ '; } else if (r >= visibleRows) { r = visibleRows - 1; arrow = '↓ '; }
    const slot = used.get(r) || 0;
    used.set(r, slot + 1);
    const queue = m.orderId ? extra.queues?.get(m.orderId) : null;   // la cola de tus Limit
    const text = queue ? `${m.text} · ${queue}` : m.text;
    const label = arrow ? `${arrow}${text} ${m.price.toFixed(digits)}` : text;
    ctx.font = `600 10px ${font}`;
    const tw = ctx.measureText(label).width + 8;
    const y = HEAD_H + r * ROW_H + 2;
    const xx = 2 + slot * (tw + 2);
    ctx.fillStyle = markColor(m.side);
    ctx.fillRect(xx, y, tw, ROW_H - 4);
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.fillText(label, xx + 4, y + (ROW_H - 4) / 2);
    if (!arrow) {
      ctx.fillStyle = markColor(m.side);
      ctx.fillRect(col.price.x, HEAD_H + r * ROW_H + ROW_H - 2, col.price.w, 2);
    }
  }

  // el precio recién mandado al panel, resaltado un momento
  if (extra.pick && Date.now() - extra.pick.at < 1500) {
    const r = rowOf(extra.pick.price, top, step, n);
    if (r >= 0 && r < visibleRows) {
      ctx.strokeStyle = THEME.accent || '#2962FF';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, HEAD_H + r * ROW_H + 1, w - 2, ROW_H - 2);
    }
  }

  // pie: la fila bajo el mouse con sus números exactos, o un resumen
  const fy = h - FOOT_H;
  ctx.fillStyle = grid;
  ctx.fillRect(0, fy, w, 1);
  ctx.font = `11px ${font}`;
  ctx.fillStyle = muted;
  ctx.textAlign = 'left';
  const win = data.window_s >= 60 ? `${data.window_s / 60} min` : `${data.window_s} s`;
  if (hover != null && rows[hover]) {
    const [price, bid, ask, buy, sell, db, da] = rows[hover];
    ctx.fillText(`${price.toFixed(digits)} · compra ${fmtQty(bid) || 0} · venta ${fmtQty(ask) || 0}`, 6, fy + 10);
    const changes = data.changes ? ` · Δ ${db ? (db > 0 ? '+' : '') + fmtQty(db) : 0} / ${da ? (da > 0 ? '+' : '') + fmtQty(da) : 0}` : '';
    ctx.fillText(`negociado ${win}: compra ${fmtQty(buy) || 0}, venta ${fmtQty(sell) || 0}${changes}`, 6, fy + 25);
  } else {
    const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
    const b = sum(1);
    const a = sum(2);
    const imb = b + a > 0 ? Math.round((100 * (b - a)) / (b + a)) : 0;
    ctx.fillText(`Step ${Number(step.toFixed(10))} · a la vista: compra ${fmtQty(b)} · venta ${fmtQty(a)} (${imb > 0 ? '+' : ''}${imb}%)`, 6, fy + 10);
    ctx.fillText(`Negociado ${win}${data.trades ? '' : ' (sin trades todavía)'} · Δ = lo agregado o retirado en ${data.change_s} s`, 6, fy + 25);
  }
  const notice = extra.notice && Date.now() - extra.notice.at < NOTICE_MS ? extra.notice.text
    : 'Clic en Compra o Venta: Limit a ese precio en el panel de trading';
  ctx.fillStyle = extra.notice && Date.now() - extra.notice.at < NOTICE_MS ? (THEME.accent || '#2962FF') : muted;
  ctx.fillText(notice.length > 64 ? `${notice.slice(0, 63)}…` : notice, 6, fy + 40);
}

function loadTracks() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || {}; } catch { return {}; }
}

export default function LadderPanel({ symbol, active = true, settings, onSettings }) {
  const canvasRef = useRef(null);
  const dataRef = useRef(null);
  const errorRef = useRef(null);
  const hoverRef = useRef(null);
  const centerRef = useRef(null);
  const marksRef = useRef([]);
  const queuesRef = useRef(new Map());   // orden -> texto de su cola
  const tracksRef = useRef(loadTracks());
  const noticeRef = useRef(null);
  const pickRef = useRef(null);
  const [plan, setPlan] = useState(emptyPlan);   // entrada, stop y objetivo elegidos en el ladder
  const [planMode, setPlanMode] = useState('entry');
  const planRef = useRef(plan);
  planRef.current = plan;
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  followRef.current = follow;
  const mult = stepFor(settings, symbol);   // cada moneda recuerda su step (14/11)
  const [scale, setScale] = useState({ symbol: null, tick: null, auto: null });   // para decir el step en precio
  const windowS = LADDER_WINDOWS.includes(settings?.window) ? settings.window : 300;

  const redraw = useCallback(() => {
    if (canvasRef.current) {
      draw(canvasRef.current, dataRef.current, errorRef.current, hoverRef.current, marksRef.current,
        { queues: queuesRef.current, notice: noticeRef.current, pick: pickRef.current, plan: planRef.current });
    }
  }, []);

  const rowsWanted = () => {
    const h = canvasRef.current?.clientHeight || 600;
    return Math.max(10, Math.floor((h - HEAD_H - FOOT_H) / ROW_H));
  };

  // otra moneda u otro step: empezar centrado en el precio
  useEffect(() => {
    dataRef.current = null;
    errorRef.current = null;
    centerRef.current = null;
    setFollow(true);
    redraw();
  }, [symbol, mult, redraw]);
  // otra moneda: el plan empieza de cero
  useEffect(() => { setPlan(emptyPlan()); setPlanMode('entry'); }, [symbol]);
  useEffect(() => { redraw(); }, [plan, redraw]);

  // tus posiciones y órdenes
  useEffect(() => {
    const update = () => { marksRef.current = ladderMarks(linesFor(symbol)); redraw(); };
    update();
    return subscribeBook(update);
  }, [symbol, redraw]);

  // pedidos al servidor: ~4 por segundo a la vista, cada 2 s si la pestaña no se ve
  useEffect(() => {
    let stop = false;
    let timer = null;
    const tick = async () => {
      const rows = rowsWanted();
      const params = new URLSearchParams({ step: String(mult), rows: String(rows), window: String(windowS) });
      if (centerRef.current) params.set('center', String(centerRef.current));
      // tus Limit de esta moneda: lo que espera y lo negociado en su precio exacto, para la cola
      const limits = linesFor(symbol).filter(l => l.kind === 'order' && l.orderType === 'Limit' && l.orderId && l.price > 0);
      const now = Date.now();
      if (limits.length) params.set('watch', limits.map(o => `${o.price}:${tracksRef.current[o.orderId]?.since ?? now}`).join(','));
      try {
        const r = await fetch(`/api/book/ladder/${encodeURIComponent(symbol)}?${params}`);
        const d = await r.json().catch(() => ({}));
        if (stop) return;
        if (!r.ok || !d.success) {
          errorRef.current = d.detail || `error ${r.status}`;
          dataRef.current = null;
        } else {
          errorRef.current = null;
          dataRef.current = d;
          const queues = new Map();
          const keep = {};
          limits.forEach((o, k) => {
            const w = d.watch?.[k];
            if (!w) return;
            const track = tracksRef.current[o.orderId] || startQueue(o, w, now);
            keep[o.orderId] = track;
            queues.set(o.orderId, `${queueText(queueNow(track, w, o.side), track.late)}${w.partial ? ' · parcial' : ''}`);
          });
          queuesRef.current = queues;
          if (JSON.stringify(keep) !== JSON.stringify(tracksRef.current)) {
            tracksRef.current = keep;   // las órdenes que ya no están (llenas o canceladas) salen
            try { localStorage.setItem(QUEUE_KEY, JSON.stringify(keep)); } catch { /* sin almacenamiento */ }
          }
          setScale(v => (v.symbol === symbol && v.tick === d.tick && (mult || v.auto === d.step) ? v
            : { symbol, tick: d.tick, auto: mult ? (v.symbol === symbol ? v.auto : null) : d.step }));
          const price = d.last || d.mid;
          if (followRef.current) {
            const next = followCenter(centerRef.current, price, d.step, rows);
            if (next !== centerRef.current) centerRef.current = next;
          } else if (!centerRef.current) {
            centerRef.current = price;
          }
        }
      } catch {
        if (stop) return;
        errorRef.current = 'sin respuesta del servidor';
        dataRef.current = null;
      }
      redraw();
      if (!stop) timer = setTimeout(tick, active && !document.hidden ? POLL_MS : HIDDEN_POLL_MS);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [symbol, mult, windowS, active, redraw]);

  // tamaño y estilo
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [redraw]);

  const onWheel = (e) => {
    const d = dataRef.current;
    if (!d) return;
    const rows = Math.max(3, Math.round(d.rows.length / 6));
    centerRef.current = (centerRef.current || d.mid) + (e.deltaY > 0 ? -1 : 1) * rows * d.step;
    setFollow(false);
  };
  const onMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const i = Math.floor((e.clientY - rect.top - HEAD_H) / ROW_H);
    const n = dataRef.current?.rows.length || 0;
    const next = i >= 0 && i < n && e.clientY - rect.top < rect.height - FOOT_H ? i : null;
    if (next !== hoverRef.current) { hoverRef.current = next; redraw(); }
  };
  const onLeave = () => { hoverRef.current = null; redraw(); };
  // Clic: la Limit a ese precio va al panel de trading, que pide la confirmación de siempre
  const onClick = (e) => {
    const d = dataRef.current;
    if (!d) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const i = Math.floor((e.clientY - rect.top - HEAD_H) / ROW_H);
    if (i < 0 || i >= d.rows.length || e.clientY - rect.top >= rect.height - FOOT_H) return;
    const col = COLS.find(c => x >= c.x && x < c.x + c.w)?.key;
    const price = d.rows[i][0];
    const side = pickSide(col, price, d.best_bid, d.best_ask);
    const now = Date.now();
    const digits = priceDigits(d.step, d.tick);
    const r = planClick(planRef.current, planMode, price, side);
    pickRef.current = { price, at: now };
    if (r.error) {
      noticeRef.current = { text: r.error, at: now };
    } else {
      setPlan(r.plan);
      setPlanMode(r.mode);
      planRef.current = r.plan;
      if (planReady(r.plan)) {
        drawBox(r.plan, digits);
      } else if (planMode === 'entry') {
        sendPick(makePick(symbol, price, r.plan.side, now));
        noticeRef.current = { text: `Al panel: Limit ${r.plan.side === 'long' ? 'compra' : 'venta'} a ${price.toFixed(digits)} · ahora elige el stop`, at: now };
      } else {
        noticeRef.current = { text: `${PLAN_NAMES[planMode]} en ${price.toFixed(digits)} · ahora elige el ${PLAN_NAMES[r.mode].toLowerCase()}`, at: now };
      }
    }
    redraw();
    setTimeout(redraw, 1600);
  };

  // Con entrada, stop y objetivo: la caja TP/SL de la moneda (la del ladder se reemplaza), en el servidor y en las otras
  // pestañas; el panel de trading la toma y prepara la Limit con ese stop y ese objetivo
  const drawBox = async (p, digits) => {
    const box = planBox(p, symbol);
    if (!box) return;
    try {
      const d = await getJson(`/api/drawings/${encodeURIComponent(symbol)}`);
      const list = withBox(d.shapes || [], box);
      await postJson(`/api/drawings/${encodeURIComponent(symbol)}`, { shapes: list, interval: d.interval || '' });
      sendDrawings(symbol, list);
      sendPick({ ...makePick(symbol, p.entry, p.side), kind: 'box' });
      noticeRef.current = { text: `Caja TP/SL dibujada · ${planSummary(p)} · confírmala en el panel`, at: Date.now() };
    } catch (e) {
      noticeRef.current = { text: `No se pudo dibujar la caja: ${e.message}`, at: Date.now() };
    }
    redraw();
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--t-line, #d0d4da)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', flexWrap: 'wrap' }}>
        <span className="wl-muted" style={{ fontWeight: 600 }}>Ladder</span>
        <select className="suite-select" value={mult} onChange={(e) => onSettings({ steps: { ...(settings?.steps || {}), [symbol]: Number(e.target.value) } })} aria-label="Step del ladder"
          title="Cuánto precio junta cada fila (en ticks de esta moneda). Cada moneda recuerda el suyo. Automático: ~0.01% del precio">
          {LADDER_STEPS.map(s => {
            const known = scale.symbol === symbol;
            return <option key={s} value={s}>{stepLabel(s, known ? scale.tick : null, known ? scale.auto : null)}</option>;
          })}
        </select>
        <select className="suite-select" value={windowS} onChange={(e) => onSettings({ window: Number(e.target.value) })} aria-label="Ventana de lo negociado"
          title="Lo negociado en cada precio en los últimos minutos">
          {LADDER_WINDOWS.map(s => <option key={s} value={s}>{`Negoc. ${s / 60} min`}</option>)}
        </select>
        <button type="button" className={`suite-btn ${follow ? 'active' : ''}`} onClick={() => { centerRef.current = null; setFollow(true); }}
          title="Seguir al precio. La rueda del mouse mueve el ladder y deja de seguirlo">Centrar</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px 4px', flexWrap: 'wrap' }}>
        <span className="wl-muted">Clic pone:</span>
        {PLAN_MODES.map(m => (
          <button key={m} type="button" className={`suite-btn ${planMode === m ? 'active' : ''}`} onClick={() => setPlanMode(m)}
            title={m === 'entry' ? 'El clic pone la entrada (en Compra, una compra; en Venta, una venta)'
              : m === 'sl' ? 'El clic pone el stop' : 'El clic pone el objetivo'}>
            {PLAN_NAMES[m]}{plan[m] ? ' ✓' : ''}
          </button>
        ))}
        {(plan.entry || plan.sl || plan.tp) && (
          <button type="button" className="suite-btn" onClick={() => { setPlan(emptyPlan()); setPlanMode('entry'); }}
            title="Borrar la entrada, el stop y el objetivo elegidos aquí (la caja dibujada queda)">Limpiar</button>
        )}
      </div>
      <canvas ref={canvasRef} style={{ flex: 1, width: '100%', minHeight: 0, display: 'block' }}
        onWheel={onWheel} onMouseMove={onMove} onMouseLeave={onLeave} onClick={onClick}
        title="Clic en Compra o Venta: una Limit a ese precio en el panel de trading, que pide la confirmación" />
    </div>
  );
}
