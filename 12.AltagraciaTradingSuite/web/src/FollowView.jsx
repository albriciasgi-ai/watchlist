import React, { useCallback, useEffect, useRef, useState } from 'react';
import { THEME } from '@app1/components/uiTheme.js';
import { useUiTheme } from '@app1/components/useUiTheme.js';
import { elementLabel } from '@app1/components/backtesting/elementLabels.js';
import { getJson } from './api.js';
import { TAB, openScannerTab } from './tabs.js';
import TabsMenu from './TabsMenu.jsx';
import {
  LIST_NAMES, favAdv, fracPct, groupBars, listText, minutesText, nearSignals, num, offsetText, pct, priceRange, rateText,
  short, sideText, signalRows, signalText, signalsShort, signed, stateText, timelineText, touchText, whenText
} from './followView.js';

/**
 * Módulo "Seguimiento" (24/11/2026, docs/PLAN_SEGUIMIENTO_SCANNER.md): cada hallazgo del scanner, qué pasó en sus 24 h y
 * qué se estaba encendiendo. El servidor (scan_follow.py) lo mide con la historia de Bybit a las 24 h y 10 min; aquí se
 * mira: la lista, el detalle con sus 48 h (precio en ATR desde el hallazgo, volumen, OI, cuentas en largo, BTC y los
 * elementos del probador de App 1) y el informe contra el control. Nunca envía nada.
 */
const POLL_MS = 30000;
const DAYS = [1, 3, 7, 14];
const REPORT_DAYS = [7, 14, 30, 60, 90];
const label = (code) => elementLabel(code, code);

// ==================== el gráfico de un hallazgo ====================
const PRICE_H = 230;
const VOL_H = 30;
const PANEL_H = 34;
const ROW_H = 10;
const AXIS_H = 16;
const LEFT = 150;
const RIGHT = 46;
const SPAN = 1440;   // minutos a cada lado del hallazgo

function chartLayout(ep, width) {
  // Velas de 15 min: la serie viene en 15 min (o en 5, la de un hallazgo abierto en una version anterior: se juntan de a 3)
  const group = Math.max(1, Math.round(900000 / (ep.series?.step || 900000)));
  const barMin = ((ep.series?.step || 900000) * group) / 60000;
  const bars = groupBars(ep.series, group).filter(b => b.t >= ep.t0 - SPAN * 60000 - 15 * 60000 && b.t <= ep.t0 + SPAN * 60000);
  const big = ep.o?.big;
  const { rows, hidden } = signalRows(ep.signals, 16, [[-60, 60], ...(big ? [[big.min - 60, big.min]] : [])]);
  const plotW = Math.max(100, width - LEFT - RIGHT);
  const offOf = (t) => (t - ep.t0) / 60000;
  const x = (off) => LEFT + ((off + SPAN) / (2 * SPAN)) * plotW;
  const [lo, hi] = priceRange(bars);
  const top = 8;
  const y = (v) => top + ((hi - v) / (hi - lo)) * PRICE_H;
  const volTop = top + PRICE_H + 6;
  const panels = [
    { key: 'oi', name: 'OI (%)', top: volTop + VOL_H + 6 },
    { key: 'long', name: 'Cuentas en largo (%)', top: volTop + VOL_H + 6 + PANEL_H + 4, scale: 100 },
    { key: 'btc', name: 'BTC (%)', top: volTop + VOL_H + 6 + 2 * (PANEL_H + 4) }
  ];
  const rowsTop = panels[2].top + PANEL_H + 8;
  const height = rowsTop + rows.length * ROW_H + (hidden ? ROW_H : 0) + AXIS_H + 6;
  return { bars, barMin, rows, hidden, plotW, offOf, x, y, lo, hi, top, volTop, panels, rowsTop, height };
}

function drawChart(canvas, ep, hover) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  if (!w) return null;
  const L = chartLayout(ep, w);
  const h = L.height;
  if (canvas.style.height !== `${h}px`) canvas.style.height = `${h}px`;
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
  const up = THEME.up || '#089981';
  const down = THEME.down || '#F23645';
  const accent = THEME.accent || '#2962FF';
  ctx.fillStyle = THEME.chartBg || '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  ctx.font = `11px ${font}`;
  const right = L.x(SPAN);
  const bottom = h - AXIS_H;

  // horas: cada 6 h, el hallazgo en 0
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = muted;
  ctx.textAlign = 'center';
  for (let off = -SPAN; off <= SPAN; off += 360) {
    const xx = Math.round(L.x(off)) + 0.5;
    ctx.beginPath(); ctx.moveTo(xx, L.top); ctx.lineTo(xx, bottom); ctx.stroke();
    ctx.fillText(off === 0 ? '0' : `${off > 0 ? '+' : '−'}${Math.abs(off) / 60} h`, xx, bottom + AXIS_H / 2 + 1);
  }

  // precio, en ATR de 1 h desde el precio del hallazgo
  const side = ep.side || 1;
  for (const level of [-3, -2, 0, 2, 3]) {
    const yy = Math.round(L.y(level)) + 0.5;
    const favor = level * side > 0;
    ctx.strokeStyle = level === 0 ? muted : Math.abs(level) === 3 ? (favor ? up : down) : grid;
    ctx.setLineDash(level === 0 ? [] : [4, 3]);
    ctx.beginPath(); ctx.moveTo(LEFT, yy); ctx.lineTo(right, yy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = Math.abs(level) === 3 ? (favor ? up : down) : muted;
    ctx.textAlign = 'left';
    ctx.fillText(level === 0 ? 'hallazgo' : `${level > 0 ? '+' : '−'}${Math.abs(level)} ATR`, right + 4, yy);
  }
  const step = (ep.series?.step || 900000) / 60000;
  const bw = Math.max(1, (L.plotW / ((2 * SPAN) / L.barMin)) * 0.7);
  for (const b of L.bars) {
    const off = L.offOf(b.t) + L.barMin / 2;
    const xx = L.x(off);
    const color = b.c >= b.o ? up : down;
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(Math.round(xx) + 0.5, L.y(b.h)); ctx.lineTo(Math.round(xx) + 0.5, L.y(b.l)); ctx.stroke();
    ctx.fillStyle = color;
    const y1 = L.y(Math.max(b.o, b.c));
    ctx.fillRect(xx - bw / 2, y1, bw, Math.max(1, L.y(Math.min(b.o, b.c)) - y1));
  }
  // el hallazgo
  const x0 = Math.round(L.x(0)) + 0.5;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x0, L.top); ctx.lineTo(x0, bottom); ctx.stroke();
  ctx.lineWidth = 1;
  // la carrera y el movimiento importante
  const o = ep.o || {};
  // La etiqueta de 2 ATR va a la izquierda de su punto y la de 3 ATR a la derecha: suelen caer cerca y se pisaban
  const mark = (minutes, way, level, textLabel, color, toLeft) => {
    const dir = way === 'sigue' ? side : -side;
    const xx = L.x(minutes);
    const yy = L.y(dir * level);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(xx, yy, level === 3 ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.font = `600 11px ${font}`;
    const left = toLeft ? xx - 160 > LEFT : xx > right - 200;
    const tw = ctx.measureText(textLabel).width;
    const tx = left ? xx - 8 - tw : xx + 8;
    const ty = yy + (dir > 0 ? -10 : 10);
    ctx.fillStyle = THEME.labelBg || 'rgba(255, 255, 255, 0.85)';   // se lee sobre las velas
    ctx.fillRect(tx - 3, ty - 7, tw + 6, 14);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(textLabel, tx, ty);
    ctx.font = `11px ${font}`;
  };
  if (o.touch === 'sigue' || o.touch === 'gira') mark(o.touch_min, o.touch, 2, `2 ATR: ${o.touch}`, o.touch === 'sigue' ? up : down, true);
  if (o.big) mark(o.big.min, o.big.way, 3, `3 ATR: ${o.big.way} a los ${minutesText(o.big.min)}`, accent, false);
  ctx.fillStyle = muted;
  ctx.textAlign = 'left';
  ctx.fillText(`Precio en ATR de 1 h · lado ${sideText(side)}`, 6, L.top + 6);

  // volumen
  const vmax = Math.max(1, ...L.bars.map(b => b.v || 0));
  ctx.fillStyle = muted;
  ctx.fillText('Volumen', 6, L.volTop + VOL_H / 2);
  for (const b of L.bars) {
    const hh = ((b.v || 0) / vmax) * VOL_H;
    ctx.fillStyle = b.c >= b.o ? up : down;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(L.x(L.offOf(b.t) + L.barMin / 2) - bw / 2, L.volTop + VOL_H - hh, bw, hh);
    ctx.globalAlpha = 1;
  }

  // OI, cuentas en largo y BTC, como líneas
  const series = ep.series || {};
  for (const p of L.panels) {
    const values = (series[p.key] || []).map(v => (v === null || v === undefined ? null : v * (p.scale || 1)));
    const known = values.filter(v => v !== null);
    ctx.fillStyle = muted;
    ctx.textAlign = 'left';
    ctx.fillText(p.name, 6, p.top + PANEL_H / 2);
    if (!known.length) continue;
    let lo = Math.min(...known);
    let hi = Math.max(...known);
    if (p.key !== 'long') { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const yy = (v) => p.top + ((hi - v) / (hi - lo)) * PANEL_H;
    ctx.strokeStyle = grid;
    const ref = p.key === 'long' ? 50 : 0;
    if (ref >= lo && ref <= hi) {
      ctx.beginPath(); ctx.moveTo(LEFT, Math.round(yy(ref)) + 0.5); ctx.lineTo(right, Math.round(yy(ref)) + 0.5); ctx.stroke();
    }
    ctx.strokeStyle = p.key === 'btc' ? muted : accent;
    ctx.beginPath();
    let started = false;
    values.forEach((v, i) => {
      const off = L.offOf(series.start + i * series.step) + step / 2;
      if (v === null || off < -SPAN || off > SPAN) { started = false; return; }
      const xx = L.x(off);
      if (!started) { ctx.moveTo(xx, yy(v)); started = true; } else ctx.lineTo(xx, yy(v));
    });
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.fillText(`${num(hi, 1)}`, right + 4, p.top + 5);
    ctx.fillText(`${num(lo, 1)}`, right + 4, p.top + PANEL_H - 5);
  }

  // elementos: una fila por elemento y marco
  L.rows.forEach((row, r) => {
    const yy = L.rowsTop + r * ROW_H + ROW_H / 2;
    ctx.fillStyle = muted;
    ctx.textAlign = 'left';
    const name = `${label(row.code)} ${row.tf === 60 ? '1h' : `${row.tf}m`}`;
    ctx.fillText(name.length > 26 ? `${name.slice(0, 25)}…` : name, 6, yy);
    for (const it of row.items) {
      const xx = L.x(it.off);
      ctx.fillStyle = it.dir > 0 ? up : down;
      ctx.beginPath();
      if (it.dir > 0) { ctx.moveTo(xx, yy - 4); ctx.lineTo(xx - 3.5, yy + 3); ctx.lineTo(xx + 3.5, yy + 3); } else { ctx.moveTo(xx, yy + 4); ctx.lineTo(xx - 3.5, yy - 3); ctx.lineTo(xx + 3.5, yy - 3); }
      ctx.fill();
    }
  });
  if (L.hidden) {
    ctx.fillStyle = muted;
    ctx.fillText(`y ${L.hidden} elementos más (los que más se encienden)`, 6, L.rowsTop + L.rows.length * ROW_H + ROW_H / 2);
  }

  // la cruz
  if (hover && Number.isFinite(hover.off)) {
    const xx = Math.round(L.x(hover.off)) + 0.5;
    ctx.strokeStyle = THEME.crosshair || muted;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(xx, L.top); ctx.lineTo(xx, bottom); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = text;
  return L;
}

function FollowChart({ ep, onHover }) {
  const canvasRef = useRef(null);
  const layoutRef = useRef(null);
  const hoverRef = useRef(null);
  const theme = useUiTheme();
  const redraw = useCallback(() => {
    if (canvasRef.current && ep?.series?.c) layoutRef.current = drawChart(canvasRef.current, ep, hoverRef.current);
  }, [ep]);
  useEffect(() => { redraw(); }, [redraw, theme]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [redraw]);
  const move = (e) => {
    const L = layoutRef.current;
    if (!L) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < LEFT || px > L.x(SPAN)) { hoverRef.current = null; onHover(null); redraw(); return; }
    const off = ((px - LEFT) / L.plotW) * 2 * SPAN - SPAN;
    const series = ep.series;
    const i = Math.round((ep.t0 + off * 60000 - series.start) / series.step - 0.5);
    if (i < 0 || i >= series.c.length) return;
    hoverRef.current = { off };
    const t = series.start + i * series.step;
    const at = (t - ep.t0) / 60000;
    const width = series.step / 60000;
    const near = (ep.signals || []).filter(([, , s]) => s > at && s <= at + width);   // los que se conocen al cerrar esa vela
    onHover({ off: at + width, t: t + series.step, c: series.c[i], v: series.v?.[i], oi: series.oi?.[i], long: series.long?.[i],
      btc: series.btc?.[i], prem: series.prem?.[i], near });
    redraw();
  };
  const leave = () => { hoverRef.current = null; onHover(null); redraw(); };
  return <canvas ref={canvasRef} style={{ width: '100%', height: 420, display: 'block' }} onMouseMove={move} onMouseLeave={leave} />;
}

// ==================== el detalle ====================
function Detail({ ep, loading, error, onClose, note, onOpenChart }) {
  const [hover, setHover] = useState(null);
  if (loading && !ep) return <div className="bot-section"><div className="bot-empty">Midiendo el hallazgo con la historia de Bybit…</div></div>;
  if (error) {
    return (
      <div className="bot-section">
        <div className="bot-warning">{error}</div>
        <button type="button" className="suite-btn" onClick={onClose}>Cerrar</button>
      </div>
    );
  }
  if (!ep) return null;
  const f = ep.f || {};
  const hv = ep.h || {};
  const o = ep.o || {};
  const row = { ...ep, elapsed_min: ep.state === 'abierto' ? (Date.now() - ep.t0) / 60000 : null };
  const near = nearSignals(ep.signals, ep.side, -60, 240);
  const vars = [
    ['Volumen de 24 h', f.rvol_24h === null || f.rvol_24h === undefined ? '—' : `×${num(f.rvol_24h)}`, 'Contra la misma hora de días del mismo tipo (el scanner)'],
    ['Volumen de 1 h', f.rvol_1h === null || f.rvol_1h === undefined ? '—' : `×${num(f.rvol_1h)}`, 'Contra la misma hora de días del mismo tipo (el scanner)'],
    ['Movimiento propio de 24 h', fracPct(f.resid_24h), 'El retorno menos la parte que pone BTC'],
    ['Ya se movió en 24 h', `${signed(hv.pre_24h)} ATR`, 'Desde 24 h antes del hallazgo, a favor del lado'],
    ['En la hora anterior', `${signed(hv.pre_1h)} ATR`, 'A favor del lado'],
    ['OI de 1 h (scanner)', fracPct(f.oi_1h), ''],
    ['OI: hora anterior · 1 h y 4 h después', `${fracPct(hv.oi_pre1h)} · ${fracPct(hv.oi_1h)} · ${fracPct(hv.oi_4h)}`, 'De Bybit, en 5 min. Lo de después solo describe'],
    ['Funding de 8 h', fracPct(f.funding_8h, 3), 'Positivo: los largos pagan'],
    ['Cuentas en largo', hv.long === null || hv.long === undefined ? '—' : `${num(hv.long * 100, 0)} % (${signed((hv.long_chg1h || 0) * 100, 1)} puntos en 1 h)`, 'Proporción de cuentas de Bybit en largo'],
    ['Prima del funding', hv.prem_bps === null || hv.prem_bps === undefined ? '—' : `${num(hv.prem_bps, 1)} bps (1 h: ${num(hv.prem1h_bps, 1)})`, 'La prima sobre el índice, en la última vela de 5 min cerrada'],
    ['Volumen de la última hora', hv.vol_rel1h === null || hv.vol_rel1h === undefined ? '—' : `×${num(hv.vol_rel1h)}`, 'Contra el promedio por hora de las 23 anteriores'],
    ['Ruptura de 20 días', f.break20 > 0 ? 'del máximo' : f.break20 < 0 ? 'del mínimo' : 'no', ''],
    ['Costo de operar', f.cost_r_1h === null || f.cost_r_1h === undefined ? '—' : `${num(f.cost_r_1h, 2)} R`, 'Ida y vuelta, en R de un stop de 1 ATR de 1 h (el scanner)'],
    ['ATR de 1 h', ep.atr_used ? pct(ep.atr_used * 100, 2) : '—', 'La unidad de todo lo medido'],
    ['BTC: 24 h antes · 1 h · 4 h · 24 h después', `${fracPct(hv.btc_pre24h)} · ${fracPct(hv.btc_1h)} · ${fracPct(hv.btc_4h)} · ${fracPct(hv.btc_24h)}`, ''],
    ['Mercado', ep.market?.reading || '—', ep.market?.hint || ''],
    ['Motivos', (ep.chips || []).join(' · ') || '—', 'Lo que dijo el scanner al entrar']
  ];
  return (
    <div className="bot-section">
      <div className="suite-add-coin" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>
          {short(ep.symbol)} · {ep.kind === 'control' ? 'control' : listText(ep)} · lado {sideText(ep.side)} · {ep.kind === 'control' ? 'elegida' : 'hallada'} el {whenText(ep.t0)} a {ep.p0_used || ep.p0}
        </h3>
        <span>
          <button type="button" className="suite-btn" onClick={() => onOpenChart(ep.symbol)} title="En otra pestaña, en 15 min, como las monedas del scanner">Abrir en el gráfico</button>
          {' '}<button type="button" className="suite-btn" onClick={onClose}>Cerrar</button>
        </span>
      </div>
      {note && <div className="bot-empty">{note}</div>}
      <div className="wl-row">
        <b>{stateText(row)}</b>
        {ep.state !== 'abierto' && <span> · carrera a 2 ATR: {touchText(ep)}{o.touch_min ? ` a los ${minutesText(o.touch_min)}` : ''}</span>}
        {o['4h'] && <span> · 4 h: a favor {num(o['4h'].fav)}, en contra {num(o['4h'].adv)} ATR</span>}
        {o['24h'] && <span> · cierre de 24 h: {signed(o['24h'].close)} ATR</span>}
        {ep.state === 'abierto' && <span className="wl-muted"> · se mide del todo a las 24 h y 10 min; esto es lo que va</span>}
        {ep.err && <span className="neg"> · {ep.err}</span>}
      </div>
      {ep.series?.c ? <FollowChart ep={ep} onHover={setHover} /> : <div className="bot-empty">Sin velas de Bybit.</div>}
      <div className="wl-muted" style={{ minHeight: 16 }}>
        {hover
          ? `${offsetText(hover.off)} (${whenText(hover.t)}) · precio ${signed(hover.c, 2)} ATR · OI ${signed(hover.oi, 2)} % · largos ${hover.long === null || hover.long === undefined ? '—' : `${num(hover.long * 100, 0)} %`} · BTC ${signed(hover.btc, 2)} %`
            + (hover.near?.length ? ` · ${hover.near.map(([c, tf, , d]) => `${label(c)} ${tf === 60 ? '1h' : `${tf}m`} ${d > 0 ? '↑' : '↓'}`).join(', ')}` : '')
          : 'Pasa el mouse sobre el gráfico para ver cada vela. Las velas son de 15 min; la línea azul, el hallazgo; los puntos, cuando llegó a 2 y a 3 ATR. Abajo, primero los elementos que se encendieron cerca del hallazgo o antes del movimiento, y de ellos los que menos se encienden.'}
      </div>
      <div className="wl-row wl-muted">Listas en sus 24 h: {timelineText(ep.lists, Math.min(Date.now(), ep.t0 + SPAN * 60000))}{ep.prev_h ? ` · el hallazgo anterior de esta moneda fue ${num(ep.prev_h, 1)} h antes` : ''}{ep.startup ? ' · del arranque: el scanner no miraba antes' : ''}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, marginTop: 8 }}>
        <div>
          <h3>Al hallazgo</h3>
          <table className="bot-table">
            <tbody>
              {vars.map(([k, v, title]) => <tr key={k} title={title}><td>{k}</td><td>{v}</td></tr>)}
            </tbody>
          </table>
        </div>
        <div>
          <h3>Elementos de la hora antes a las 4 h después</h3>
          {near.length === 0 ? <div className="bot-empty">Ninguno.</div> : (
            <table className="bot-table">
              <thead><tr><th>Cuándo</th><th>Elemento</th><th>Marco</th><th>Dirección</th></tr></thead>
              <tbody>
                {near.slice(0, 40).map((s, i) => (
                  <tr key={`${s.code}-${s.tf}-${s.off}-${i}`} title={o.big && s.off > o.big.min ? 'Después del movimiento importante' : ''}>
                    <td>{offsetText(s.off)}</td>
                    <td>{label(s.code)}</td>
                    <td>{s.tf === 60 ? '1h' : `${s.tf}m`}</td>
                    <td className={s.favor ? 'pos' : 'neg'}>{s.dir > 0 ? '↑' : '↓'} {s.favor ? 'a favor' : 'en contra'}{o.big && s.off > o.big.min ? ' · después' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {near.length > 40 && <div className="wl-muted">y {near.length - 40} más</div>}
        </div>
      </div>
    </div>
  );
}

// ==================== el informe ====================
function BlockCells({ b }) {
  return (
    <>
      <td>{b.n}</td>
      <td>{pct(b.big_pct)}</td>
      <td>{rateText(b.big_sigue_pct, b.big_n)}</td>
      <td>{b.big_min === null || b.big_min === undefined ? '—' : minutesText(b.big_min)}</td>
      <td>{rateText(b.race_sigue_pct, b.race_n)}</td>
      <td>{favAdv(b['4h'])}</td>
      <td>{signed(b['24h']?.close, 2)}</td>
    </>
  );
}

function ReportView({ report, days, setDays, startup, setStartup, onRefresh, loading, error }) {
  return (
    <>
      <div className="bot-section">
        <div className="suite-add-coin">
          <span>Días</span>
          <select className="suite-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {REPORT_DAYS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <label style={{ cursor: 'pointer' }} title="Las del arranque ya venían moviéndose: su hora no es la del hallazgo">
            <input type="checkbox" checked={startup} onChange={(e) => setStartup(e.target.checked)} /> Sumar los del arranque
          </label>
          <button type="button" className="suite-btn" onClick={onRefresh} disabled={loading}>{loading ? 'Leyendo…' : 'Actualizar'}</button>
        </div>
        {error && <div className="bot-warning">{error}</div>}
        {report && (
          <div className="wl-muted">
            Medidos desde el {whenText(report.since)} · {report.open} todavía por medir (con el control) · {report.no_data} sin datos de Bybit.
            Todo en ATR de 1 h desde el precio del hallazgo, visto desde su lado; «sigue» es a favor del lado.
          </div>
        )}
      </div>
      {report && (
        <>
          <div className="bot-section">
            <h3>Qué pasó en 24 h</h3>
            <table className="bot-table">
              <thead>
                <tr>
                  <th>Grupo</th><th title="Con sus 24 h medidas">Con 24 h</th><th title="Se alejó 3 ATR del precio del hallazgo en 24 h">Movimiento de 3 ATR</th>
                  <th title="De los que se movieron 3 ATR, cuántos a favor del lado">Sigue</th><th title="Mediana">Hasta el movimiento</th>
                  <th title="Llegó antes a 2 ATR a favor que a 2 en contra">Carrera a 2 ATR: sigue</th><th title="Medianas, en ATR">4 h a favor / en contra</th><th title="Mediana, a favor del lado">Cierre de 24 h</th>
                </tr>
              </thead>
              <tbody>
                {report.blocks.map(b => <tr key={b.id}><td>{b.label}</td><BlockCells b={b} /></tr>)}
              </tbody>
            </table>
          </div>
          <div className="bot-section">
            <h3>Los ocho cortes del plan</h3>
            <div className="wl-muted">La carrera a 2 ATR: cuántos siguen a favor del lado, con el corte y sin él, en los hallazgos y en el control.</div>
            <table className="bot-table">
              <thead><tr><th>Corte</th><th>Hallazgos con</th><th>Hallazgos sin</th><th>Control con</th><th>Control sin</th></tr></thead>
              <tbody>
                {report.splits.map(s => (
                  <tr key={s.id}>
                    <td>{s.label}</td>
                    <td>{rateText(s.yes.race_sigue_pct, s.yes.race_n)}</td>
                    <td>{rateText(s.no.race_sigue_pct, s.no.race_n)}</td>
                    <td>{rateText(s.control_yes.race_sigue_pct, s.control_yes.race_n)}</td>
                    <td>{rateText(s.control_no.race_sigue_pct, s.control_no.race_n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bot-section">
            <h3>Elementos al hallazgo</h3>
            <div className="wl-muted">
              Encendidos en la hora antes del hallazgo, con {report.signals.min_n} casos o más: cuánto sigue la carrera con el
              elemento y sin él. Primero el reparto: <b>{report.signals.pass} de {report.signals.tests}</b> pasan de ±2 errores;
              por azar se esperan {report.signals.expected}. Con muchas pruebas, alguna pasa sola.
            </div>
            {report.signals.rows.length === 0 ? <div className="bot-empty">Todavía no hay elementos con {report.signals.min_n} casos.</div> : (
              <table className="bot-table">
                <thead><tr><th>Elemento</th><th>Con</th><th>Sin</th><th title="La diferencia en errores estándar">Errores</th><th>Control con</th><th title="En el control">Errores</th></tr></thead>
                <tbody>
                  {report.signals.rows.map(r => (
                    <tr key={r.key}>
                      <td>{signalText(r.key, label)}</td>
                      <td>{rateText(r.sigue_pct, r.n)}</td>
                      <td>{rateText(r.sin_pct, r.sin_n)}</td>
                      <td className={Math.abs(r.z || 0) >= 2 ? 'pos' : ''}>{signed(r.z, 1)}</td>
                      <td>{rateText(r.control_pct, r.control_n)}</td>
                      <td>{signed(r.control_z, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="bot-section">
            <h3>Antes del movimiento importante</h3>
            <div className="wl-muted">
              De los {report.before_big.n} hallazgos con movimiento de 3 ATR: qué se encendió en la hora anterior, contra una hora
              cualquiera de sus 48 h. Solo describe: no dice qué anticipa.
            </div>
            {report.before_big.rows.length === 0 ? <div className="bot-empty">Todavía no hay elementos con {report.before_big.min_n} casos.</div> : (
              <table className="bot-table">
                <thead><tr><th>Elemento</th><th>Hallazgos</th><th>En la hora antes</th><th>En una hora cualquiera</th><th>Veces</th></tr></thead>
                <tbody>
                  {report.before_big.rows.map(r => (
                    <tr key={r.key}>
                      <td>{signalText(r.key, label)}</td><td>{r.n}</td><td>{pct(r.pct)}</td><td>{pct(r.any_pct)}</td><td>{num(r.lift, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="bot-section">
            <div className="bot-empty">
              Sirve para mirar y elegir hipótesis, no para operar. Una regla de compra se fija aparte, antes de correrla, y se
              juzga en datos que no se miraron (docs/PLAN_SEGUIMIENTO_SCANNER.md).
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ==================== el módulo ====================
export default function FollowView({ active = true, onBack, onWatchlist, onOpenTheme, onModule }) {
  const [status, setStatus] = useState(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ days: 3, lista: '', startup: '', kind: 'hallazgo' });
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState({ ep: null, loading: false, error: null });
  const [note, setNote] = useState(null);
  const [tab, setTab] = useState('lista');
  const [report, setReport] = useState({ data: null, loading: false, error: null });
  const [reportDays, setReportDays] = useState(30);
  const [reportStartup, setReportStartup] = useState(false);

  const read = useCallback(async () => {
    const q = new URLSearchParams({ days: String(filters.days), kind: filters.kind });
    if (filters.kind === 'hallazgo' && filters.lista) q.set('lista', filters.lista);
    if (filters.kind === 'hallazgo' && filters.startup) q.set('startup', filters.startup);
    try {
      const [st, list] = await Promise.all([getJson('/api/follow/status'), getJson(`/api/follow/episodes?${q}`)]);
      setStatus(st);
      setRows(list.rows);
      setError(null);
    } catch (e) {
      setError(`Sin respuesta del servidor: ${e.message}`);
    }
  }, [filters]);

  useEffect(() => {
    if (!active) return undefined;
    read();
    const timer = setInterval(read, POLL_MS);
    return () => clearInterval(timer);
  }, [active, read]);

  const open = useCallback(async (id) => {
    setSelected(id);
    setNote(null);
    setDetail({ ep: null, loading: true, error: null });
    try {
      const r = await getJson(`/api/follow/episode/${id}`);
      setDetail({ ep: r.episode, loading: false, error: null });
    } catch (e) {
      setDetail({ ep: null, loading: false, error: e.status === 503 ? `Bybit no respondió: ${e.message}` : `No se pudo leer: ${e.message}` });
    }
  }, []);

  const readReport = useCallback(async () => {
    setReport(r => ({ ...r, loading: true, error: null }));
    try {
      const r = await getJson(`/api/follow/report?days=${reportDays}&startup=${reportStartup ? 1 : 0}`);
      setReport({ data: r.report, loading: false, error: null });
    } catch (e) {
      setReport(r => ({ ...r, loading: false, error: `No se pudo leer el informe: ${e.message}` }));
    }
  }, [reportDays, reportStartup]);

  useEffect(() => {
    if (active && tab === 'informe') readReport();
  }, [active, tab, readReport]);

  const openChart = (symbol) => {
    const n = openScannerTab(symbol, '15m');
    setNote(n ? `Abierta en la pestaña ${n}, en 15 min.` : 'Las pestañas 2 a 5 están abiertas: cierra una para abrir la moneda.');
  };

  const st = status;
  const state = !st ? 'Leyendo…'
    : st.running ? (st.due ? `Midiendo: quedan ${st.due} por medir${st.busy ? ` (${short(st.busy.split('-').pop())})` : ''}` : 'Encendido: mide cada hallazgo a las 24 h y 10 min')
      : st.env_off ? 'Apagado en este servidor (SUITE_FOLLOW=0 o SUITE_SCANNER=0)'
        : st.other_process ? 'Otro proceso mide con esta carpeta de datos' : 'Encendido; empieza en unos segundos';
  const setFilter = (key, value) => setFilters(f => ({ ...f, [key]: value }));
  return (
    <div className="suite-root">
      <div className="suite-bar">
        <button type="button" className="suite-btn" onClick={onBack}>← Gráfico</button>
        <button type="button" className="suite-btn" onClick={onWatchlist}>Watchlist</button>
        <span className="suite-title">Seguimiento del scanner{TAB > 1 ? ` · pestaña ${TAB}` : ''}</span>
        {[['lista', 'Hallazgos'], ['informe', 'Informe']].map(([id, text]) => (
          <button key={id} type="button" className={`suite-btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{text}</button>
        ))}
        <div className="suite-spacer" />
        <TabsMenu onModule={onModule} />
        <button type="button" className="suite-btn" onClick={onOpenTheme}>Estilo</button>
      </div>
      <div className="suite-main">
        <div className="bot-view">
          {error && <div className="bot-warning">{error}</div>}
          {st?.state_error && <div className="bot-warning">{st.state_error}</div>}
          {(st?.errors || []).slice(-1).map(e => <div key={e.at} className="bot-warning">{e.text}</div>)}
          {st && (
            <div className="bot-cards">
              <div className="bot-card"><div className="label">Estado</div><div className="value" style={{ fontSize: 13 }}><span className={`suite-dot ${st.running ? 'ok' : 'bad'}`} />{state}</div></div>
              <div className="bot-card"><div className="label">Abiertos (24 h)</div><div className="value">{st.open.hallazgo} · {st.open.control} de control</div></div>
              <div className="bot-card"><div className="label">Medidos (14 días)</div><div className="value">{st.measured.hallazgo} · {st.measured.control} de control</div></div>
              <div className="bot-card" title="La hora del primer hallazgo que se sigue"><div className="label">Desde</div><div className="value">{whenText(st.since)}</div></div>
            </div>
          )}
          {tab === 'informe' ? (
            <ReportView report={report.data} loading={report.loading} error={report.error} days={reportDays} setDays={setReportDays}
              startup={reportStartup} setStartup={setReportStartup} onRefresh={readReport} />
          ) : (
            <>
              {selected && <Detail ep={detail.ep} loading={detail.loading} error={detail.error} note={note} onOpenChart={openChart}
                onClose={() => { setSelected(null); setDetail({ ep: null, loading: false, error: null }); setNote(null); }} />}
              <div className="bot-section">
                <div className="suite-add-coin">
                  <select className="suite-select" value={filters.kind} onChange={(e) => setFilter('kind', e.target.value)} aria-label="Qué mostrar">
                    <option value="hallazgo">Hallazgos</option>
                    <option value="control">Control</option>
                  </select>
                  <span>Días</span>
                  <select className="suite-select" value={filters.days} onChange={(e) => setFilter('days', Number(e.target.value))}>
                    {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  {filters.kind === 'hallazgo' && (
                    <>
                      <select className="suite-select" value={filters.lista} onChange={(e) => setFilter('lista', e.target.value)} aria-label="Lista">
                        <option value="">Todas las listas</option>
                        {Object.entries(LIST_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                      </select>
                      <select className="suite-select" value={filters.startup} onChange={(e) => setFilter('startup', e.target.value)} aria-label="Arranque">
                        <option value="">En vivo y del arranque</option>
                        <option value="0">Solo en vivo</option>
                        <option value="1">Solo del arranque</option>
                      </select>
                    </>
                  )}
                  <span className="wl-muted">{rows ? `${rows.length} ${filters.kind === 'control' ? 'de control' : 'hallazgos'}` : ''}</span>
                </div>
                {!rows ? <div className="bot-empty">Leyendo…</div> : rows.length === 0 ? (
                  <div className="bot-empty">
                    Todavía ninguno. Cada moneda que entra a En juego, Tendencia o Rápidos sin estar en ninguna es un hallazgo; se
                    mide a las 24 h y 10 min con la historia de Bybit.
                  </div>
                ) : (
                  <table className="bot-table">
                    <thead>
                      <tr>
                        <th>{filters.kind === 'control' ? 'Elegida' : 'Hallada'}</th><th>Moneda</th><th>Lista</th><th title="El lado en que se movía al entrar">Lado</th>
                        <th title="El movimiento importante: la primera vez que se alejó 3 ATR de 1 h del precio del hallazgo">Movimiento de 3 ATR</th>
                        <th title="Si llegó antes a 2 ATR a favor del lado o en contra">Carrera a 2 ATR</th>
                        <th title="Lo máximo a favor y en contra en 4 h, en ATR">4 h a favor / en contra</th><th title="El cierre a las 24 h, a favor del lado, en ATR">Cierre de 24 h</th>
                        <th title="Elementos del probador encendidos en la hora antes: + a favor del lado, − en contra">Al hallazgo</th>
                        <th title="Volumen de 24 h contra la misma hora de días del mismo tipo">Volumen</th>
                        <th title="Costo de ida y vuelta en R de un stop de 1 ATR de 1 h">Costo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.id} className="wl-signal" onClick={() => open(r.id)}
                          style={r.id === selected ? { background: 'var(--t-accent-soft, #e8eefc)' } : undefined}
                          title={r.err || (r.startup ? 'Del arranque: el scanner no miraba antes, y esta moneda ya venía moviéndose' : '')}>
                          <td>{whenText(r.t0)}</td>
                          <td><b>{short(r.symbol)}</b></td>
                          <td>{listText(r)}</td>
                          <td>{sideText(r.side)}</td>
                          <td className={r.o?.big ? (r.o.big.way === 'sigue' ? 'pos' : 'neg') : ''}>{stateText(r)}</td>
                          <td className={r.o?.touch === 'sigue' ? 'pos' : r.o?.touch === 'gira' ? 'neg' : ''}>{touchText(r)}</td>
                          <td>{favAdv(r.o?.['4h'])}</td>
                          <td>{signed(r.o?.['24h']?.close)}</td>
                          <td title={(r.s?.sa || []).map(k => signalText(k, label)).join('\n')}>{signalsShort(r.s?.sa, 3)}</td>
                          <td>{r.f?.rvol_24h === undefined ? '—' : `×${num(r.f.rvol_24h)}`}</td>
                          <td>{r.f?.cost_r_1h === undefined ? '—' : `${num(r.f.cost_r_1h, 2)} R`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="bot-section">
                <div className="bot-empty">
                  Un hallazgo es una moneda que entra a una lista sin estar en ninguna (volver antes de 2 h es el mismo). Se mide en
                  ATR de 1 h desde su precio, a las 24 h y 10 min, con la historia de Bybit: no graba nada en vivo ni envía nada. El
                  control son 2 candidatas al azar de cada vuelta, fuera de las listas. Los del arranque ya venían moviéndose.
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
