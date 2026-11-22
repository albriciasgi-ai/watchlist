import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MiniChart from '@app1/components/MiniChart';
import wsManager from '@app1/components/WebSocketManager';
import { getJson, postJson } from './api.js';
import { linesFor } from './botBook.js';
import { TAB, onAnyDrawings, onSymbolsChanged, symbolsChanged } from './tabs.js';
import TabsMenu from './TabsMenu.jsx';
import { INTERVAL_CODE, SWING, attachSwing, feedSwing, frameName, onSwingChanged, swingOf } from './swingServer.js';

/**
 * Watchlist (paso 5, parte C, 13/11/2026): las monedas de la suite en una cuadrícula, cada una con el gráfico de App 1
 * en vivo.
 * - Marco y días comunes, de 1 a 5 columnas. El orden se cambia arrastrando el nombre de una moneda.
 * - Cada gráfico se arrastra para ver otras velas y se acerca o aleja con la rueda (las velas se comprimen como en
 *   App 1; Ctrl + rueda cambia la escala de precios; →| vuelve a la última vela). Es solo para mirar (viewOnly de
 *   MiniChart): sus dibujos se ven pero no se mueven, y un clic no elige niveles. Un clic en el nombre abre la moneda
 *   en el gráfico principal, en el marco de la cuadrícula, con todos sus indicadores.
 * - "+" agrega una moneda de Bybit a la suite sin salir de la Watchlist.
 * - Indicadores livianos, los mismos para todas las monedas. Los pesados quedan en el gráfico principal: con todas las
 *   monedas a la vez pedirían demasiado a Bybit.
 * - Ningún gráfico se pausa: todos reciben sus velas y sus precios. Los que se ven se dibujan a lo sumo cada 0.5 s y los
 *   que no se ven cada 30 s (liveRedrawMs de MiniChart). Al volver a verse se dibujan en el acto.
 * - Los gráficos se arman de a uno, porque Bybit cuenta los pedidos por segundo.
 * - Panel del Swing del servidor: si detecta, su marco, las monedas que vigila y las últimas señales. No envía alertas.
 *   Debajo, los tres sabios de Williams y la estructura SMC del servidor (20/11), igual: tampoco envían nada.
 */

// 1D, 1W y 1M (16/11): la semana empieza el lunes y el mes el día 1; el mes no tiene Swing
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1D', '1W', '1M'];
const SWING_TFS = ['1m', '5m', '15m', '1h', '4h'];   // marcos que el Swing del servidor puede vigilar en vivo
const WS_CODE = { ...INTERVAL_CODE, '1M': 'M' };
const TF_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1D': 86400000,
  '1W': 604800000, '1M': 2592000000 };
// Días que carga cada gráfico (el principal carga más): en casi todos los marcos es un solo pedido a Bybit por moneda
const DAY_OPTIONS = { '1m': [1, 2, 3], '5m': [1, 3, 5, 10], '15m': [2, 5, 10, 30], '1h': [7, 14, 30, 60, 120], '4h': [30, 60, 120, 365],
  '1D': [90, 180, 365, 1000], '1W': [365, 730, 1825, 2600], '1M': [1095, 2600, 3000] };
const DEFAULT_DAYS = { '1m': 1, '5m': 3, '15m': 5, '1h': 14, '4h': 60, '1D': 180, '1W': 730, '1M': 3000 };
// Indicadores livianos: se calculan en la página o los da el servidor sin pedir más a Bybit
const LIGHT = [
  ['Swing Detector', 'Swing (del servidor)'], ['Volume Delta', 'Delta de volumen'], ['CVD', 'CVD'], ['FVG', 'FVG'],
  ['S&R v2', 'S&R v2'], ['Volume Profile', 'Perfil de volumen'], ['Volumen de Respuesta', 'Volumen de Respuesta'], ['Lector VPA', 'Lector VPA'],
  ['Estructura SMC', 'Estructura SMC'], ['Alligator', 'Alligator'], ['Fractales', 'Fractales'], ['Tres sabios', 'Tres sabios'],
  ['Zonas de Williams', 'Zonas de Williams'], ['AO', 'AO (Williams)'],
];
const LIGHT_NAMES = new Set(LIGHT.map(([name]) => name));
const ALL_OFF = Object.fromEntries([
  'Volume Delta', 'Volume Profile', 'CVD', 'Open Interest', 'OI-Volume Confluence', 'Order Flow', 'FVG', 'VP Periodic',
  'Volumen de Respuesta', 'Lector VPA', 'Liquidaciones', 'Elementos OF', 'VWAP', 'Range Detection', 'Rejection Patterns',
  'Double Top/Bottom', 'Support & Resistance', 'S&R v2', 'Swing Detector', 'Estructura SMC', 'Alligator', 'Fractales', 'Tres sabios',
  'Zonas de Williams', 'AO', 'AC', 'Gator', 'MFI',
].map(name => [name, false]));
const DEFAULT_ON = { 'Swing Detector': true };
const VP_CONFIG = { mode: 'dynamic', rowCount: 100, valueAreaPercent: 70, hideWhenFixedRanges: false, showPOC: true, showVAH: true, showVAL: true };
const CELL_HEIGHT = { 1: 460, 2: 340, 3: 280, 4: 240, 5: 210 };
const VISIBLE_MS = 500;   // a la vista: a lo sumo un dibujo por precio cada medio segundo
const HIDDEN_MS = 30000;  // fuera de la vista: uno cada 30 s, con las velas al día
const MOUNT_GAP_MS = 400; // un gráfico nuevo cada 0.4 s
const SWING_VISUAL = { arrowSize: 8, arrowOffset: 6 };
const SETTINGS_KEY = `suite_watchlist_${TAB}`;
const noop = () => {};
const none = () => [];

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

const clampDays = (tf, days) => (DAY_OPTIONS[tf].includes(days) ? days : DEFAULT_DAYS[tf]);

function priceText(p) {
  if (!Number.isFinite(p)) return '—';
  if (p >= 1000) return p.toFixed(1);
  if (p >= 10) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toPrecision(4);
}

const colombiaTime = (ms) => new Date(ms).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' });

/** Nombre, precio y cambio de 24 h de una moneda, con los precios del WebSocket que ya usa su gráfico (uno por segundo) */
function CellHead({ symbol, tf, note, onOpen, onDragStart, onDragEnd }) {
  const [tick, setTick] = useState({ price: null, pct: null });
  useEffect(() => {
    const merged = {};
    let last = 0;
    let timer = null;
    const flush = () => {
      timer = null;
      last = Date.now();
      setTick({ price: merged.price ?? null, pct: merged.pct ?? null });
    };
    const onMessage = (data) => {
      if (!data?.topic?.startsWith('tickers.')) return;
      const d = data.data || {};
      if (d.lastPrice !== undefined) merged.price = parseFloat(d.lastPrice);
      if (d.price24hPcnt !== undefined) merged.pct = parseFloat(d.price24hPcnt) * 100;
      if (!timer) timer = setTimeout(flush, Math.max(0, last + 1000 - Date.now()));
    };
    const code = WS_CODE[tf];
    wsManager.subscribe(symbol, onMessage, code);
    return () => {
      if (timer) clearTimeout(timer);
      wsManager.unsubscribe(symbol, onMessage, code);
    };
  }, [symbol, tf]);
  const pct = tick.pct;
  return (
    <div className="wl-head" draggable onClick={onOpen} onDragStart={onDragStart} onDragEnd={onDragEnd} title="Un clic la abre en el gráfico principal; arrástrala para cambiar el orden">
      <span className="wl-sym">{symbol.replace(/USDT$/, '')}</span>
      <span>{priceText(tick.price)}</span>
      {Number.isFinite(pct) && <span className={pct >= 0 ? 'pos' : 'neg'}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</span>}
      <span className="suite-spacer" />
      {note && <span className="wl-note" title={note.title}>{note.text}</span>}
    </div>
  );
}

/** El gráfico de una moneda: solo se vuelve a dibujar en React si cambia lo suyo (los demás estados de la vista no lo tocan) */
const GridChart = React.memo(function GridChart({ symbol, tf, days, states, redrawMs, chartRef, getPositionLines }) {
  return (
    <div className="backtesting-main" style={{ height: '100%' }}>
      <div className="timeframes-container" style={{ height: '100%' }}>
        <div className="timeframe-panel" style={{ display: 'block', height: '100%' }}>
          <MiniChart
            ref={chartRef}
            symbol={symbol}
            interval={tf}
            days={days}
            isActive={false}
            indicatorStates={states}
            backtestingMode={false}
            vpConfig={VP_CONFIG}
            vpFixedRange={null}
            oiMode="histogram"
            rejectionPatternConfig={null}
            currentTool="select"
            onToolChange={noop}
            getTradeBoundaries={none}
            getPositionLines={getPositionLines}
            chosenStyle="numbers"
            liveRedrawMs={redrawMs}
            viewOnly
            onRequestPause={noop}
            onRequestTimeChange={noop}
            onDrawingsChange={noop}
          />
        </div>
      </div>
    </div>
  );
});

/** El Swing del servidor: si detecta, su marco, las monedas que vigila y lo último que anotó. Nada se envía al bot */
function PanelTitle({ onHide }) {
  return (
    <div className="wl-panel-title">
      <h3>Swing del servidor</h3>
      <button type="button" className="suite-btn" onClick={onHide} title="Ocultar el panel (se vuelve a abrir con «Panel del Swing»)">Ocultar ›</button>
    </div>
  );
}

// Marcos que vigilan los sabios y la estructura SMC del servidor (wise_smc_watch.py)
const WSMC_TFS = [['15', '15m'], ['60', '1h'], ['240', '4h'], ['D', '1D']];
const WSMC_NAME = Object.fromEntries(WSMC_TFS);

/** Los tres sabios de Williams y la estructura SMC del servidor: si detecta, su marco y lo último que anotó. Nada se envía */
function WiseSmcSections({ wsmc, onChange, onOpenChart }) {
  const status = wsmc.status;
  if (!status) {
    return (
      <div className="bot-section">
        <h3>Sabios de Williams y estructura SMC</h3>
        <div className="bot-empty">{wsmc.error ? `Sin respuesta del servidor: ${wsmc.error}` : 'Cargando…'}</div>
      </div>
    );
  }
  const state = status.detecting ? 'Detecta en vivo'
    : !status.enabled ? 'Apagado'
      : status.env_off ? 'Apagado en este servidor (SUITE_WSMC=0)'
        : status.other_process ? 'Otro proceso detecta con esta carpeta de datos' : 'Encendido; empieza en el próximo cierre';
  const coins = status.allSymbols ? `Todas las monedas de la suite (${status.symbols.length})` : `${status.symbols.length} monedas`;
  return (
    <>
      <div className="bot-section">
        <h3>Sabios de Williams y estructura SMC</h3>
        <div className="wl-row">
          <span className={`suite-dot ${status.detecting ? 'ok' : 'bad'}`} />
          <span>{state}</span>
        </div>
        <div className="wl-row">
          <button type="button" className="suite-btn" disabled={wsmc.saving} onClick={() => onChange({ enabled: !status.enabled })}>
            {status.enabled ? 'Apagar la detección' : 'Encender la detección'}
          </button>
        </div>
        <div className="wl-row">
          <span>Marco que vigila</span>
          <select className="suite-select" value={status.interval} disabled={wsmc.saving} onChange={(e) => onChange({ interval: e.target.value })}>
            {WSMC_TFS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </div>
        <div className="wl-row wl-muted">{coins}. Hoy: {status.today ?? 0} señales. No envía alertas: quedan para la central de confluencia.</div>
        <div className="wl-row wl-muted" title="Medido en el probador de App 1, fase 1 en 4h, con las siete monedas de siempre (20/11)">
          Barra divergente, AO tres barras, ruptura de fractal, ruptura de estructura, order block, breaker y barrido de iguales.
          Ninguna superó al azar en el probador: son ayudas de lectura, no señales.
        </div>
        {wsmc.error && <div className="suite-result bad">{wsmc.error}</div>}
      </div>
      <div className="bot-section">
        <h3>Últimas de los sabios y SMC</h3>
        {wsmc.log.length === 0 ? <div className="bot-empty">Todavía ninguna.</div> : (
          <table className="bot-table">
            <thead><tr><th>Hora</th><th>Moneda</th><th>Señal</th></tr></thead>
            <tbody>
              {wsmc.log.map(e => (
                <tr key={`${e.symbol}-${e.code}-${e.dir}-${e.t}-${e.info?.scope || ''}`} className="wl-signal"
                    onClick={() => onOpenChart(e.symbol, WSMC_NAME[e.interval] || '4h')}
                    title={`${e.text} · vela de las ${colombiaTime(e.t)} en ${WSMC_NAME[e.interval] || e.interval}, anotada a ${(e.delay_ms / 1000).toFixed(1)} s de saberse`}>
                  <td>{colombiaTime(e.known_at)}</td>
                  <td>{e.symbol.replace(/USDT$/, '')}</td>
                  <td className={e.dir > 0 ? 'pos' : 'neg'}>{e.code === 'BS' && e.info?.tag ? e.info.tag : e.name}{e.info?.scope === 'internal' ? ' (interna)' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// DX en vivo (dx_watch.py): fechas, precios y R como los da el servidor
// Día y hora en 24 h ("26/11 02:00"): las tablas del panel no parten las líneas y el panel es angosto
const colombiaStamp = (ms) => {
  const d = new Date(ms);
  const day = d.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit' });
  return `${day} ${d.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false })}`;
};
const colombiaDay = (ms) => new Date(ms).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' });
const dxPrice = (x) => {
  if (x == null || !Number.isFinite(x)) return '—';
  const size = Math.abs(x);
  const digits = size >= 1000 ? 1 : size >= 100 ? 2 : size > 0 ? Math.max(2, Math.min(8, 3 - Math.floor(Math.log10(size)))) : 2;
  return x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const dxR = (x, digits = 3) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(digits)}`);
// Nombres cortos: el texto completo de cada evento va al pasar el mouse
const DX_EVENT = { armada: 'Armada', entrada: 'Entrada', salida: 'Salida', vencida: 'Vencida',
  'no entra': 'No entra (ocupada)', 'no se opera': 'No se opera', revision: 'Revisión' };

/** DX en vivo: la hipótesis de los apilados desplazados, con la regla del probador de App 1 sobre el almacén en vivo.
 *  Registra órdenes, entradas y salidas; nada se envía al bot. Cómo se juzga: docs/PLAN_ESTRATEGIAS_BYKO_DALE.md, «DX en vivo» */
function DxSections({ dx, onChange, onOpenChart }) {
  const status = dx.status;
  if (!status) {
    return (
      <div className="bot-section">
        <h3>DX en vivo (apilados desplazados)</h3>
        <div className="bot-empty">{dx.error ? `Sin respuesta del servidor: ${dx.error}` : 'Cargando…'}</div>
      </div>
    );
  }
  const state = status.detecting ? 'Registra en vivo'
    : !status.enabled ? 'Apagado'
      : status.env_off ? 'Apagado en este servidor (SUITE_DX=0)'
        : status.other_process ? 'Otro proceso registra con esta carpeta de datos' : 'Encendido; empieza en el próximo cierre';
  const report = dx.report || {};
  const book = report.book || {};
  const exec = report.exec || {};
  const next = (report.checkpoints || []).find(m => !m.due && m.at);
  const done = (report.checkpoints || []).filter(m => m.due);
  const rows = [];
  for (const sym of status.symbols || []) {
    const s = status.by_symbol?.[sym] || {};
    for (const o of s.open || []) rows.push({ ...o, kind: 'abierta' });
    for (const o of s.pending || []) rows.push({ ...o, kind: 'esperando' });
  }
  const failing = (status.symbols || []).filter(s => status.by_symbol?.[s]?.error);
  const waiting = (status.symbols || []).reduce((n, s) => n + (status.by_symbol?.[s]?.pendingCount || 0), 0);
  return (
    <>
      <div className="bot-section">
        <h3>DX en vivo (apilados desplazados)</h3>
        <div className="wl-row">
          <span className={`suite-dot ${status.detecting ? 'ok' : 'bad'}`} />
          <span>{state}</span>
        </div>
        <div className="wl-row">
          <button type="button" className="suite-btn" disabled={dx.saving} onClick={() => onChange({ enabled: !status.enabled })}>
            {status.enabled ? 'Apagar el registro' : 'Encender el registro'}
          </button>
        </div>
        <div className="wl-row wl-muted" title="Limit en el borde cercano de la zona movida, válida 200 velas; stop de 10% a 20% del ATR diario; objetivo 2R; una posición a la vez por moneda">
          {status.since ? `Desde el ${colombiaDay(status.since)}` : 'Empieza con el primer cierre'} · {(status.symbols || []).length} monedas en 30m · la regla de las fases 2 y 3, sin cambios. No envía nada al bot.
        </div>
        <div className="wl-row">
          {book.n ? `${book.n} trades · acierto ${(book.winRate * 100).toFixed(1)}% · ${dxR(book.avgR)} R por trade${book.low != null ? ` (de ${dxR(book.low)} a ${dxR(book.high)})` : ''}` : 'Todavía sin trades cerrados.'}
        </div>
        {book.n ? (
          <div className="wl-row wl-muted" title="La salida al precio de una orden a mercado disparada en el stop o el objetivo, medido en la cinta">
            Con la ejecución medida: {dxR(exec.avgR)} R por trade ({report.measured ?? 0} de {book.n} medidos).
            {report.slippage?.stops ? ` Deslizamiento mediano en el stop: ${report.slippage.medianPct.toFixed(3)}%.` : ''}
          </div>
        ) : null}
        {done.map(m => (
          <div key={m.months} className="wl-row">
            Lectura de los {m.months} meses: {m.verdict}{m.stats?.n ? ` (${m.stats.n} trades, ${dxR(m.stats.avgR)} R)` : ''}.
          </div>
        ))}
        {next ? <div className="wl-row wl-muted">Próxima lectura del plan: {colombiaDay(next.at)}, a los {next.months} meses.</div> : null}
        {failing.length > 0 && (
          <div className="suite-result bad">{failing.map(s => `${s.replace(/USDT$/, '')}: ${status.by_symbol[s].error}`).join(' · ')}</div>
        )}
        {dx.error && <div className="suite-result bad">{dx.error}</div>}
      </div>
      <div className="bot-section">
        <h3>Órdenes de DX</h3>
        {waiting > 0 && (
          <div className="wl-row wl-muted">{waiting} esperando en total; se ven las 3 más cerca del precio de cada moneda y las posiciones abiertas.</div>
        )}
        {rows.length === 0 ? <div className="bot-empty">Ninguna esperando ni abierta.</div> : (
          <table className="bot-table">
            <thead><tr><th>Moneda</th><th>Orden</th><th>Vence / R</th></tr></thead>
            <tbody>
              {rows.map(o => (
                <tr key={o.key} className="wl-signal" onClick={() => onOpenChart(o.symbol, '15m')}
                    title={o.kind === 'abierta'
                      ? `Posición abierta: ${o.dir > 0 ? 'largo' : 'corto'} en ${dxPrice(o.entry)} · stop ${dxPrice(o.stop)} · objetivo ${dxPrice(o.target)} · ${dxR(o.open_r)} R al último cierre`
                      : `Limit de ${o.dir > 0 ? 'compra' : 'venta'} en ${dxPrice(o.limit)} · stop ${dxPrice(o.stop)} · objetivo ${dxPrice(o.target)} · armada el ${colombiaStamp(o.armed_at)}, vence el ${colombiaStamp(o.expires_at)}`}>
                  <td>{o.symbol.replace(/USDT$/, '')}</td>
                  <td className={o.dir > 0 ? 'pos' : 'neg'}>
                    {o.kind === 'abierta' ? `${o.dir > 0 ? 'Largo' : 'Corto'} ${dxPrice(o.entry)}` : `${o.dir > 0 ? 'Compra' : 'Venta'} ${dxPrice(o.limit)}`}
                  </td>
                  <td>{o.kind === 'abierta' ? `${dxR(o.open_r, 2)} R` : colombiaStamp(o.expires_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="bot-section">
        <h3>Últimas entradas y salidas de DX</h3>
        {dx.log.length === 0 ? <div className="bot-empty">Todavía ninguna.</div> : (
          <table className="bot-table">
            <thead><tr><th>Hora</th><th>Moneda</th><th>Qué pasó</th></tr></thead>
            <tbody>
              {dx.log.map(e => (
                <tr key={`${e.key}-${e.type}-${e.detected_at}`} className="wl-signal" onClick={() => onOpenChart(e.symbol, '15m')}
                    title={`${e.text} · anotado a ${Math.round((e.delay_ms || 0) / 1000)} s de ocurrir`}>
                  <td>{colombiaTime(e.at)}</td>
                  <td>{e.symbol.replace(/USDT$/, '')}</td>
                  <td className={e.type === 'salida' ? ((e.r ?? 0) >= 0 ? 'pos' : 'neg') : e.dir > 0 ? 'pos' : 'neg'}>
                    {DX_EVENT[e.type] || e.type}{e.type === 'salida' && e.r != null ? ` · ${dxR(e.r, 2)} R` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function SwingPanel({ swing, symbols, gridTf, onChange, onOpenChart, onHide, extra = null }) {
  const status = swing.status;
  if (!status) {
    return (
      <div className="wl-panel">
        <div className="bot-section"><PanelTitle onHide={onHide} /></div>
        <div className="bot-empty">{swing.error ? `Sin respuesta del servidor: ${swing.error}` : 'Cargando…'}</div>
        {extra}
      </div>
    );
  }
  const watched = new Set(status.symbols || []);
  const liveTf = frameName(status.interval);
  const state = status.detecting ? 'Detecta en vivo' : status.enabled ? (status.other_process ? 'Otro proceso detecta con esta carpeta de datos' : 'Encendido; empieza en el próximo cierre') : 'Apagado';
  const toggleCoin = (sym) => {
    const next = watched.has(sym) ? (status.symbols || []).filter(s => s !== sym) : [...(status.symbols || []), sym];
    if (next.length) onChange({ symbols: next });
  };
  return (
    <div className="wl-panel">
      <div className="bot-section">
        <PanelTitle onHide={onHide} />
        <div className="wl-row">
          <span className={`suite-dot ${status.detecting ? 'ok' : 'bad'}`} />
          <span>{state}</span>
        </div>
        <div className="wl-row">
          <button type="button" className="suite-btn" disabled={swing.saving} onClick={() => onChange({ enabled: !status.enabled })}>
            {status.enabled ? 'Apagar la detección' : 'Encender la detección'}
          </button>
        </div>
        <div className="wl-row">
          <span>Marco que vigila</span>
          <select className="suite-select" value={liveTf} disabled={swing.saving} onChange={(e) => onChange({ interval: INTERVAL_CODE[e.target.value] })}>
            {SWING_TFS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="wl-row wl-muted">
          {liveTf === gridTf ? `La cuadrícula está en el mismo marco: sus flechas son las que anota.` : `La cuadrícula está en ${gridTf}: sus flechas son solo para ver.`}
        </div>
        {liveTf !== gridTf && SWING_TFS.includes(gridTf) && (
          <div className="wl-row">
            <button type="button" className="suite-btn" disabled={swing.saving} onClick={() => onChange({ interval: INTERVAL_CODE[gridTf] })}>
              Vigilar en {gridTf}
            </button>
          </div>
        )}
        <div className="wl-row wl-muted">Hoy: {status.today ?? 0} señales. No envía alertas: quedan para la central de confluencia.</div>
        {swing.error && <div className="suite-result bad">{swing.error}</div>}
      </div>
      <div className="bot-section">
        <h3>Monedas vigiladas ({watched.size})</h3>
        <div className="wl-coins">
          {symbols.map(sym => (
            <label key={sym} className="wl-coin">
              <input type="checkbox" checked={watched.has(sym)} disabled={swing.saving || (watched.has(sym) && watched.size === 1)} onChange={() => toggleCoin(sym)} />
              {sym.replace(/USDT$/, '')}
            </label>
          ))}
        </div>
      </div>
      <div className="bot-section">
        <h3>Últimas señales</h3>
        {swing.log.length === 0 ? <div className="bot-empty">Todavía ninguna.</div> : (
          <table className="bot-table">
            <thead><tr><th>Hora</th><th>Moneda</th><th>Swing</th><th>Precio</th></tr></thead>
            <tbody>
              {swing.log.map(e => (
                <tr key={`${e.symbol}-${e.type}-${e.timestamp}`} className="wl-signal" onClick={() => onOpenChart(e.symbol, frameName(e.interval))}
                    title={`Vela de las ${colombiaTime(e.timestamp)} en ${frameName(e.interval)}, anotada a ${(e.delay_ms / 1000).toFixed(1)} s de confirmarse${e.gap ? ' · con una vela faltante' : ''}`}>
                  <td>{colombiaTime(e.known_at)}</td>
                  <td>{e.symbol.replace(/USDT$/, '')}</td>
                  <td className={e.type === 'SWING_LOW' ? 'pos' : 'neg'}>{e.type === 'SWING_LOW' ? 'bajo' : 'alto'}</td>
                  <td>{priceText(e.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {extra}
    </div>
  );
}

export default function WatchlistView({ active = true, onOpenChart, onBack, onOpenTheme, onModule = null }) {
  const saved = useMemo(loadSettings, []);
  const [symbols, setSymbols] = useState([]);
  const [tf, setTf] = useState(TIMEFRAMES.includes(saved.tf) ? saved.tf : '15m');
  const [daysByTf, setDaysByTf] = useState({ ...DEFAULT_DAYS, ...(saved.daysByTf || {}) });
  const [columns, setColumns] = useState([1, 2, 3, 4, 5].includes(saved.columns) ? saved.columns : 4);
  const [order, setOrder] = useState(Array.isArray(saved.order) ? saved.order : []);
  const [indicators, setIndicators] = useState(() => {
    const own = Object.fromEntries(Object.entries(saved.indicators || {}).filter(([name]) => LIGHT_NAMES.has(name)));
    return { ...DEFAULT_ON, ...own };
  });
  const [showPanel, setShowPanel] = useState(saved.showPanel !== false);
  const [showMenu, setShowMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [addError, setAddError] = useState('');
  const [mountedSet, setMountedSet] = useState(() => new Set());
  const [visible, setVisible] = useState(() => new Set());
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [swing, setSwing] = useState({ status: null, log: [], error: null, saving: false });
  const [wsmc, setWsmc] = useState({ status: null, log: [], error: null, saving: false });
  const [dxState, setDx] = useState({ status: null, report: null, log: [], error: null, saving: false });
  const days = clampDays(tf, daysByTf[tf]);

  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const chartRefs = useRef({});
  const refSetters = useRef({});
  const positionGetters = useRef({});
  const cellEls = useRef({});
  const observerRef = useRef(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const indicatorsRef = useRef(indicators);
  indicatorsRef.current = indicators;
  const feedsRef = useRef({});              // moneda -> estado del Swing de su gráfico (swingServer.js)
  const swingVersion = useRef({ all: 0 });  // sube con un cambio que mueve señales: de todas o de una moneda

  // Monedas de la suite: las agregadas aquí, en el gráfico principal o en otra pestaña aparecen al instante
  useEffect(() => {
    let alive = true;
    const read = () => getJson('/api/suite/symbols').then(d => alive && setSymbols(d.symbols || [])).catch(() => {});
    read();
    const timer = setInterval(read, 60000);
    const stop = onSymbolsChanged(list => alive && setSymbols(list));
    return () => { alive = false; clearInterval(timer); stop(); };
  }, []);
  const addSymbol = async () => {
    const s = newSymbol.trim().toUpperCase();
    if (!s) return;
    setAddError('');
    try {
      const d = await postJson('/api/suite/symbols', { symbol: s });
      setSymbols(d.symbols);
      symbolsChanged(d.symbols);
      setAdding(false);
      setNewSymbol('');
    } catch (e) {
      setAddError(e.message);
    }
  };

  const ordered = useMemo(
    () => [...order.filter(s => symbols.includes(s)), ...symbols.filter(s => !order.includes(s))],
    [order, symbols],
  );
  const orderedRef = useRef(ordered);
  orderedRef.current = ordered;

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ tf, daysByTf, columns, order: ordered, indicators, showPanel }));
    } catch {
      // Sin almacenamiento la vista dura hasta cerrar la página
    }
  }, [tf, daysByTf, columns, ordered, indicators, showPanel]);

  // Los gráficos se arman de a uno, en el orden de la cuadrícula. Un cambio de marco o de días los arma de nuevo
  useEffect(() => {
    setMountedSet(new Set());
    feedsRef.current = {};
  }, [tf, days]);
  useEffect(() => {
    const next = ordered.find(s => !mountedSet.has(s));
    if (!next) return undefined;
    const timer = setTimeout(() => setMountedSet(prev => new Set(prev).add(next)), mountedSet.size === 0 ? 0 : MOUNT_GAP_MS);
    return () => clearTimeout(timer);
  }, [ordered, mountedSet]);

  // Qué celdas se ven: las que no, se dibujan cada 30 s. Con el módulo oculto ninguna se ve
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      setVisible(prev => {
        const next = new Set(prev);
        entries.forEach(e => {
          const sym = e.target.dataset.symbol;
          if (e.isIntersecting) next.add(sym);
          else next.delete(sym);
        });
        return next;
      });
    }, { root: wrapRef.current, threshold: 0 });
    observerRef.current = io;
    Object.values(cellEls.current).forEach(el => el && io.observe(el));
    return () => io.disconnect();
  }, []);
  const cellRef = useCallback((sym) => {
    if (!refSetters.current[`cell:${sym}`]) {
      refSetters.current[`cell:${sym}`] = (el) => {
        const old = cellEls.current[sym];
        if (old && old !== el) observerRef.current?.unobserve(old);
        cellEls.current[sym] = el;
        if (el) observerRef.current?.observe(el);
      };
    }
    return refSetters.current[`cell:${sym}`];
  }, []);
  const chartRef = useCallback((sym) => {
    if (!refSetters.current[`chart:${sym}`]) {
      refSetters.current[`chart:${sym}`] = (el) => {
        if (el) chartRefs.current[sym] = el;
        else delete chartRefs.current[sym];
      };
    }
    return refSetters.current[`chart:${sym}`];
  }, []);
  const positionsOf = useCallback((sym) => {
    if (!positionGetters.current[sym]) positionGetters.current[sym] = () => linesFor(sym);
    return positionGetters.current[sym];
  }, []);

  // Al volver al módulo, lo que se ve se dibuja con su tamaño real
  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(() => {
      visibleRef.current.forEach(sym => chartRefs.current[sym]?.forceRedraw?.());
    }, 60);
    return () => clearTimeout(timer);
  }, [active, columns]);

  // Los dibujos que cambian en el gráfico principal o en otra pestaña llegan a la celda de su moneda (aquí no se editan)
  useEffect(() => onAnyDrawings((sym, shapes) => chartRefs.current[sym]?.loadDrawings?.(shapes, true)), []);

  // Swing del servidor en cada gráfico: al cerrar una vela del marco y cuando cambian reglas o dibujos de la moneda
  useEffect(() => onSwingChanged((sym) => {
    if (sym) swingVersion.current[sym] = (swingVersion.current[sym] || 0) + 1;
    else swingVersion.current.all += 1;
  }), []);
  useEffect(() => {
    let alive = true;
    let busy = false;
    const round = async () => {
      if (busy) return;
      busy = true;
      try {
        const list = orderedRef.current.filter(sym => chartRefs.current[sym]);
        list.forEach(sym => {
          const st = feedsRef.current[sym] || (feedsRef.current[sym] = {});
          attachSwing(st, swingOf(chartRefs.current[sym].getIndicatorManager?.()), SWING_VISUAL);
        });
        if (!indicatorsRef.current[SWING]) return;
        for (let i = 0; i < list.length && alive; i += 4) {
          await Promise.all(list.slice(i, i + 4).map(async (sym) => {
            const version = `${swingVersion.current.all}:${swingVersion.current[sym] || 0}`;
            const drew = await feedSwing(feedsRef.current[sym], {
              symbol: sym, tf, tfMs: TF_MS[tf], days, version, visual: SWING_VISUAL, isAlive: () => alive,
            });
            // Lo que no se ve muestra las flechas nuevas en su próximo dibujo (cada 30 s)
            if (drew && visibleRef.current.has(sym)) chartRefs.current[sym]?.forceRedraw?.();
          }));
        }
      } finally {
        busy = false;
      }
    };
    round();
    const timer = setInterval(round, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [tf, days]);

  // Panel del Swing: estado y últimas señales cada 30 s mientras se ve el módulo
  const readSwing = useCallback(async () => {
    try {
      const [status, log] = await Promise.all([getJson('/api/swing/status'), getJson('/api/swing/log?limit=40')]);
      setSwing(s => ({ ...s, status, log: log.signals || [], error: null }));
    } catch (e) {
      setSwing(s => ({ ...s, error: e.message }));
    }
  }, []);
  useEffect(() => {
    if (!active) return undefined;
    readSwing();
    const timer = setInterval(readSwing, 30000);
    return () => clearInterval(timer);
  }, [active, readSwing]);
  // Los sabios y la estructura SMC del servidor, con el mismo ritmo
  const readWsmc = useCallback(async () => {
    try {
      const [status, log] = await Promise.all([getJson('/api/wsmc/status'), getJson('/api/wsmc/log?limit=30')]);
      setWsmc(s => ({ ...s, status, log: log.signals || [], error: null }));
    } catch (e) {
      setWsmc(s => ({ ...s, error: e.message }));
    }
  }, []);
  useEffect(() => {
    if (!active || !showPanel) return undefined;
    readWsmc();
    const timer = setInterval(readWsmc, 30000);
    return () => clearInterval(timer);
  }, [active, showPanel, readWsmc]);
  const changeWsmc = async (body) => {
    setWsmc(s => ({ ...s, saving: true, error: null }));
    try {
      await postJson('/api/wsmc/config', body);
      await readWsmc();
    } catch (e) {
      setWsmc(s => ({ ...s, error: e.message }));
    } finally {
      setWsmc(s => ({ ...s, saving: false }));
    }
  };
  // DX en vivo, con el mismo ritmo
  const readDx = useCallback(async () => {
    try {
      const [status, report, log] = await Promise.all([getJson('/api/dx/status'), getJson('/api/dx/report'), getJson('/api/dx/log?limit=400')]);
      // Las armadas, vencidas y llenadas con otra posición abierta son muchas más (unas 40 órdenes esperan por moneda):
      // la lista muestra las entradas, las salidas y las revisiones
      const trades = (log.events || []).filter(e => e.type === 'entrada' || e.type === 'salida' || e.type === 'revision').slice(0, 20);
      setDx(s => ({ ...s, status, report, log: trades, error: null }));
    } catch (e) {
      setDx(s => ({ ...s, error: e.message }));
    }
  }, []);
  useEffect(() => {
    if (!active || !showPanel) return undefined;
    readDx();
    const timer = setInterval(readDx, 30000);
    return () => clearInterval(timer);
  }, [active, showPanel, readDx]);
  const changeDx = async (body) => {
    setDx(s => ({ ...s, saving: true, error: null }));
    try {
      await postJson('/api/dx/config', body);
      await readDx();
    } catch (e) {
      setDx(s => ({ ...s, error: e.message }));
    } finally {
      setDx(s => ({ ...s, saving: false }));
    }
  };
  const changeSwing = async (body) => {
    setSwing(s => ({ ...s, saving: true, error: null }));
    try {
      await postJson('/api/swing/config', body);
      await readSwing();
    } catch (e) {
      setSwing(s => ({ ...s, error: e.message }));
    } finally {
      setSwing(s => ({ ...s, saving: false }));
    }
  };

  // Cerrar la lista de indicadores con un clic afuera
  useEffect(() => {
    if (!showMenu) return undefined;
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showMenu]);

  // Solo en desarrollo: para revisar la cuadrícula desde la consola
  useEffect(() => {
    if (import.meta.env.DEV) window.__suiteWatchlist = { chartRefs, visibleRef, feedsRef };
  }, []);

  const states = useMemo(() => ({ ...ALL_OFF, ...indicators }), [indicators]);
  const watched = new Set(swing.status?.symbols || []);
  const liveTf = swing.status ? frameName(swing.status.interval) : null;

  // Arrastrada hacia abajo queda después de la otra; hacia arriba, antes: así llega a cualquier lugar, también al último
  const moveTo = (from, to) => {
    if (!from || from === to) return;
    const down = ordered.indexOf(from) < ordered.indexOf(to);
    const list = ordered.filter(s => s !== from);
    list.splice(list.indexOf(to) + (down ? 1 : 0), 0, from);
    setOrder(list);
  };
  const onCount = Object.values(indicators).filter(Boolean).length;

  return (
    <div className="suite-root">
      <div className="suite-bar">
        <button type="button" className="suite-btn" onClick={onBack}>← Gráfico</button>
        <span className="suite-title">Watchlist{TAB > 1 ? ` · pestaña ${TAB}` : ''}</span>
        {TIMEFRAMES.map(t => (
          <button key={t} type="button" className={`suite-btn ${t === tf ? 'active' : ''}`} onClick={() => setTf(t)}>{t}</button>
        ))}
        <span>Días</span>
        <select className="suite-select" value={days} onChange={(e) => setDaysByTf(d => ({ ...d, [tf]: Number(e.target.value) }))} aria-label="Días">
          {DAY_OPTIONS[tf].map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <span>Columnas</span>
        <select className="suite-select" value={columns} onChange={(e) => setColumns(Number(e.target.value))} aria-label="Columnas">
          {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <div className="wl-menu-anchor" ref={menuRef}>
          <button type="button" className={`suite-btn ${showMenu ? 'active' : ''}`} onClick={() => setShowMenu(v => !v)}>Indicadores ({onCount})</button>
          {showMenu && (
            <div className="suite-menu wl-menu">
              {LIGHT.map(([name, label]) => (
                <div key={name} className="suite-menu-row">
                  <label>
                    <input type="checkbox" checked={!!indicators[name]} onChange={(e) => setIndicators(s => ({ ...s, [name]: e.target.checked }))} />
                    {' '}{label}
                  </label>
                </div>
              ))}
              <div className="wl-muted wl-menu-note">
                Valen para todas las monedas. Los pesados (Order Flow, Elementos OF, VWAP, Interés abierto y patrones) quedan en el gráfico principal: con todas las monedas a la vez pedirían demasiado a Bybit.
              </div>
            </div>
          )}
        </div>
        {adding ? (
          <span className="suite-add">
            <input
              autoFocus
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter') addSymbol(); if (e.key === 'Escape') { setAdding(false); setAddError(''); } }}
              placeholder="Ej: LINKUSDT"
              aria-label="Moneda nueva"
            />
            <button type="button" className="suite-btn" onClick={addSymbol}>Agregar</button>
            <button type="button" className="suite-btn" onClick={() => { setAdding(false); setAddError(''); }}>×</button>
            {addError && <span className="suite-add-error">{addError}</span>}
          </span>
        ) : (
          <button type="button" className="suite-btn" onClick={() => setAdding(true)} title="Agregar una moneda de Bybit a la suite">+ Moneda</button>
        )}
        <div className="suite-spacer" />
        <button type="button" className={`suite-btn ${showPanel ? 'active' : ''}`} onClick={() => setShowPanel(v => !v)} title="Mostrar u ocultar el panel del Swing">Panel del Swing</button>
        <TabsMenu onModule={onModule} />
        <button type="button" className="suite-btn" onClick={onOpenTheme}>Estilo</button>
      </div>
      <div className="suite-main">
        <div className="wl-view">
          <div className="wl-grid-wrap" ref={wrapRef}>
            <div className="wl-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {ordered.map(sym => {
                const isWatched = watched.has(sym);
                const note = isWatched ? {
                  text: liveTf === tf ? 'Swing en vivo' : `Swing ${liveTf}`,
                  title: liveTf === tf ? 'El Swing del servidor vigila esta moneda en este marco' : `El Swing del servidor vigila esta moneda en ${liveTf}`,
                } : null;
                return (
                  <div
                    key={sym}
                    data-symbol={sym}
                    ref={cellRef(sym)}
                    className={`wl-cell ${dragOver === sym ? 'drag-over' : ''} ${dragging === sym ? 'dragging' : ''}`}
                    style={{ height: CELL_HEIGHT[columns] }}
                    onDragOver={(e) => { if (dragging && dragging !== sym) { e.preventDefault(); if (dragOver !== sym) setDragOver(sym); } }}
                    onDragLeave={() => setDragOver(d => (d === sym ? null : d))}
                    onDrop={(e) => { e.preventDefault(); moveTo(dragging, sym); setDragOver(null); setDragging(null); }}
                  >
                    <CellHead
                      symbol={sym}
                      tf={tf}
                      note={note}
                      onOpen={() => onOpenChart(sym, tf)}
                      onDragStart={(e) => { setDragging(sym); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', sym); }}
                      onDragEnd={() => { setDragging(null); setDragOver(null); }}
                    />
                    <div className="wl-chart">
                      {mountedSet.has(sym) ? (
                        <GridChart
                          key={`${sym}-${tf}-${days}`}
                          symbol={sym}
                          tf={tf}
                          days={days}
                          states={states}
                          redrawMs={active && visible.has(sym) ? VISIBLE_MS : HIDDEN_MS}
                          chartRef={chartRef(sym)}
                          getPositionLines={positionsOf(sym)}
                        />
                      ) : (
                        <div className="wl-placeholder">Cargando…</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {showPanel && (
            <SwingPanel swing={swing} symbols={ordered} gridTf={tf} onChange={changeSwing} onOpenChart={onOpenChart} onHide={() => setShowPanel(false)}
              extra={<>
                <WiseSmcSections wsmc={wsmc} onChange={changeWsmc} onOpenChart={onOpenChart} />
                <DxSections dx={dxState} onChange={changeDx} onOpenChart={onOpenChart} />
              </>} />
          )}
        </div>
      </div>
    </div>
  );
}
