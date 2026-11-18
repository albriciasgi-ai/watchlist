import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MiniChart from '../MiniChart';
import { API_BASE_URL } from '../../config.js';
import { useUiTheme } from '../useUiTheme.js';
import { formatR, registryChartView } from './observer.js';
import { THEME, isNewTheme } from '../uiTheme.js';
import { withoutSubdivisions } from './marketData';
import { cachedMarketData } from './SecondaryChartApp';
import ChartIndicatorSettings, { WITH_SETTINGS } from './ChartIndicatorSettings';
import { lastClosedIndex } from './replayClock';
import {
  CHART_TIMEFRAMES, MAX_ELEMENTS, MAX_FILTERS, MAX_WINDOW, VP_PERIODS, VP_SHAPES, CC_STRUCT_TFS, CC_OFFSETS, minuteOfDay, sequenceParts, usesProfile, RULE_TIMEFRAMES, TF_LABEL, defaultRule, deleteRule, describeRule,
  fmtPct, fmtR, TESTER_PARAM, fromBackendRule, loadSavedRules, saveRule, sortTrades, testerSymbol, toBackendRule, tradeBands, tradeBoxes
} from './ruleTester.js';
import '../../backtesting_styles.css';
import '../../rule_tester.css';

/**
 * Probador de reglas del Observador (?probador=1), en su propia ventana. Una regla (elementos de order flow,
 * entrada, stop y salida) se corre sobre una fase fija del histórico y cada trade queda contabilizado.
 * El gráfico no reproduce: muestra la fase completa con la caja de cada trade, y un clic en la lista lleva a él.
 * La fase 1 se ve siempre; las fases 2 y 3 muestran primero el informe y el gráfico solo cuando se pide.
 * Todo el cálculo es del backend (rule_tester.py): aquí solo se arma la regla y se lee el resultado.
 */

const DAY_MS = 86400000;
const MAX_DAYS = { '1m': 730, '5m': 1825, '15m': 1825, '1h': 1825, '4h': 1825 };
const VIEW_KEY = 'tester_view_v1';
const PAGE = 300;
const INDICATORS = [
  'Volume Delta', 'Volume Profile', 'CVD', 'Open Interest', 'OI-Volume Confluence', 'Order Flow', 'FVG', 'VP Periodic',
  'Volumen de Respuesta', 'Liquidaciones', 'Elementos OF', 'VWAP', 'Rejection Patterns', 'Support & Resistance',
  'S&R v2', 'Swing Detector'
];
const DEFAULT_ON = new Set(['Volume Delta', 'Order Flow', 'Elementos OF']);
const VP_CONFIG = { mode: 'dynamic', rowCount: 100, valueAreaPercent: 70, hideWhenFixedRanges: false, showPOC: true, showVAH: true, showVAL: true };
const TIME = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const stamp = (ms) => TIME.format(new Date(ms));
const noop = () => {};
const TF_MINUTES = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240 };

const loadView = () => {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY)) || {};
  } catch {
    return {};
  }
};

const api = async (path, body) => {
  const response = await fetch(`${API_BASE_URL}${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`El backend respondió ${response.status}`);
  return response.json();
};

const tone = (value) => {
  if (!value) return undefined;
  if (value > 0) return isNewTheme() ? THEME.upText : '#0a7d5a';
  return isNewTheme() ? THEME.downText : '#c62828';
};

const R = ({ value, digits }) => <span style={{ color: tone(value) }}>{fmtR(value, digits)}</span>;

const Num = ({ value, onChange, min, max, step = 1, disabled }) => (
  <input type="number" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
);

const Check = ({ checked, onChange, children, title }) => (
  <label title={title}><input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />{children}</label>
);

/** Curva de R acumulado, en orden de salida */
const Equity = ({ points }) => {
  if (!points?.length) return null;
  const values = points.map(p => p[1]);
  const low = Math.min(0, ...values), high = Math.max(0, ...values);
  const span = high - low || 1;
  const x = (i) => (points.length === 1 ? 300 : (i / (points.length - 1)) * 600);
  const y = (v) => 105 - ((v - low) / span) * 100;
  const last = values[values.length - 1];
  return (
    <svg className="rt-equity" viewBox="0 0 600 110" preserveAspectRatio="none">
      <line x1="0" x2="600" y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity="0.25" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      <polyline fill="none" stroke={tone(last) || 'currentColor'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" points={points.map((p, i) => `${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')} />
    </svg>
  );
};

const BriefTable = ({ title, rows, first = '' }) => (!rows?.length ? null : (
  <div className="rt-group">
    <h4>{title}</h4>
    <table className="rt-table">
      <thead><tr><th>{first}</th><th>Trades</th><th>Acierto</th><th>R medio</th><th>R total</th></tr></thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.label}><td>{row.label}</td><td>{row.n}</td><td>{fmtPct(row.winRate)}</td><td><R value={row.avgR} digits={3} /></td><td><R value={row.totalR} /></td></tr>
        ))}
      </tbody>
    </table>
  </div>
));

const SplitTable = ({ title, rows, names, note }) => (!rows?.length ? null : (
  <div className="rt-group">
    <h4>{title}</h4>
    {note && <div className="rt-note" style={{ marginBottom: 4 }}>{note}</div>}
    <table className="rt-table">
      <thead><tr><th>Elemento</th><th>Con</th><th>R medio</th><th>Sin</th><th>R medio</th><th>Dif.</th></tr></thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.label} title={names[row.label] || ''}>
            <td><b>{row.label}</b> {(names[row.label] || '').slice(0, 18)}</td>
            <td>{row.with.n} · {fmtPct(row.with.winRate)}</td><td><R value={row.with.avgR} digits={3} /></td>
            <td>{row.without.n} · {fmtPct(row.without.winRate)}</td><td><R value={row.without.avgR} digits={3} /></td>
            <td>{row.with.avgR !== null && row.without.avgR !== null ? <R value={row.with.avgR - row.without.avgR} digits={3} /> : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
));

const RuleTesterApp = () => {
  useUiTheme();
  const symbol = useMemo(testerSymbol, []);
  const view = useMemo(loadView, []);
  const [info, setInfo] = useState(null);
  const [phase, setPhase] = useState(1);
  const [rule, setRule] = useState(() => ({ ...defaultRule(), ...(view.rule || {}) }));
  const [saved, setSaved] = useState(loadSavedRules);
  const [tab, setTab] = useState('regla');
  const [job, setJob] = useState(null);
  const [results, setResults] = useState({});       // Corrida a la vista de cada fase
  const [revealed, setRevealed] = useState({});     // Fases 2 y 3 cuyo gráfico ya se pidió ver
  const [selected, setSelected] = useState(null);   // Número del trade elegido
  const [detail, setDetail] = useState(null);
  const [sens, setSens] = useState(null);
  const [message, setMessage] = useState(null);
  const [sort, setSort] = useState({ key: 'n', desc: false });
  const [shown, setShown] = useState(PAGE);
  const [chartTf, setChartTf] = useState(CHART_TIMEFRAMES.includes(view.chartTf) ? view.chartTf : '15m');
  const [indicatorStates, setIndicatorStates] = useState(() => Object.fromEntries(INDICATORS.map(name => [name, view.indicators?.[name] ?? DEFAULT_ON.has(name)])));
  const [showList, setShowList] = useState(false);
  const [settingsFor, setSettingsFor] = useState(null); // Indicador cuyo modal de ajustes está abierto
  const [vpConfig, setVpConfig] = useState(() => ({ ...VP_CONFIG, ...(view.vpConfig || {}) }));
  const [vpFixedRange, setVpFixedRange] = useState(null);
  const [rejectionConfig, setRejectionConfig] = useState(null);
  const [market, setMarket] = useState(null);
  const [status, setStatus] = useState('Cargando…');
  const [tool, setTool] = useState('select');
  const [myOrders, setMyOrders] = useState(null);   // Órdenes manuales del registro del Observador, de este símbolo
  const [ordersView, setOrdersView] = useState(false); // El gráfico muestra esas órdenes en vez de la fase
  const [pickedOrder, setPickedOrder] = useState(null);
  const chartRef = useRef(null);
  const marketRef = useRef(null);
  const extendedRef = useRef(new Map()); // Por marco, el pedido de las velas anteriores al caché
  const boxesRef = useRef([]);
  const linesRef = useRef([]);
  const bandsRef = useRef([]);

  const result = results[phase] || null;
  const phaseInfo = info?.phases?.find(p => p.phase === phase) || null;
  const names = useMemo(() => Object.fromEntries((info?.elements || []).map(e => [e.code, e.name])), [info]);
  const patch = (change) => setRule(previous => ({ ...previous, ...change }));

  const refreshInfo = useCallback(() => api(`/api/tester/info/${symbol}`).then(setInfo).catch(error => setMessage(error.message)), [symbol]);

  useEffect(() => {
    document.title = `App 1 · Backtesting global · ${symbol}`;
    refreshInfo();
  }, [symbol, refreshInfo]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ rule, chartTf, indicators: indicatorStates, vpConfig }));
    } catch {
      // Sin almacenamiento la vista dura hasta cerrar la ventana
    }
  }, [rule, chartTf, indicatorStates, vpConfig]);

  // Velas: del caché del navegador que guardó la principal. Si no están, se pide al backend solo el marco
  // del gráfico: esta ventana no necesita los cinco marcos
  useEffect(() => {
    let active = true;
    const has = (data) => data?.timeframes?.[chartTf]?.main?.length > 0;
    (async () => {
      let data = marketRef.current;
      if (has(data) && (TF_MINUTES[chartTf] < 5 || data.timeframes[chartTf].extended)) return;
      setStatus(`Cargando las velas de ${symbol}…`);
      if (!data) data = await cachedMarketData(symbol);
      if (!has(data)) {
        try {
          setStatus(`Pidiendo las velas de ${chartTf} de ${symbol} al backend…`);
          const response = await fetch(`${API_BASE_URL}/api/backtesting/bulk-data/${symbol}?timeframe=${chartTf}`);
          const part = withoutSubdivisions(await response.json());
          if (!has(part)) throw new Error('el backend no devolvió velas de ese marco');
          const known = marketRef.current || data;
          data = { ...(known || {}), ...part, timeframes: { ...(known?.timeframes || {}), ...part.timeframes } };
        } catch (error) {
          if (active) setStatus(`No se pudieron cargar las velas: ${error.message}`);
          return;
        }
      }
      // El caché de velas guarda 5 años y la fase 1 empieza antes: lo que falta sale del almacén de trades.
      // En 1m serían millones de velas: ese marco se queda con lo que tiene el caché
      const minutes = TF_MINUTES[chartTf];
      if (minutes >= 5 && !data.timeframes[chartTf].extended) {
        try {
          const main = data.timeframes[chartTf].main;
          setStatus(`Completando las velas de ${chartTf} anteriores al ${new Date(main[0].timestamp).toISOString().slice(0, 10)} (la primera vez tarda)…`);
          // Un solo pedido por marco, aunque el efecto corra dos veces: los dos esperan la misma respuesta
          if (!extendedRef.current.has(chartTf)) {
            extendedRef.current.set(chartTf, api(`/api/tester/candles/${symbol}?tf=${minutes}&before=${main[0].timestamp}`).then(early => (
              early.success ? early.t.map((t, i) => ({ timestamp: t, open: early.o[i], high: early.h[i], low: early.l[i], close: early.c[i], volume: early.v[i] })) : []
            )));
          }
          const older = (await extendedRef.current.get(chartTf)).filter(candle => candle.timestamp < main[0].timestamp);
          data = { ...data, timeframes: { ...data.timeframes, [chartTf]: { ...data.timeframes[chartTf], main: [...older, ...main], extended: true } } };
        } catch (error) {
          extendedRef.current.delete(chartTf); // Sin esas velas el gráfico sigue con las del caché, y se vuelve a intentar al volver al marco
        }
      }
      marketRef.current = data;
      if (!active) return;
      setMarket(data);
      setStatus(null);
    })();
    return () => { active = false; };
  }, [symbol, chartTf]);

  // El trabajo en curso: avance cada segundo, y al terminar se lee la corrida
  const loadRun = useCallback(async (id) => {
    const run = await api(`/api/tester/result/${id}`);
    if (!run.success) {
      setMessage(run.message || 'No se pudo leer la corrida');
      return;
    }
    setResults(previous => ({ ...previous, [run.phase]: run }));
    setPhase(run.phase);
    setSelected(null);
    setDetail(null);
    setSens(null);
    setShown(PAGE);
    setTab('resumen');
  }, []);

  useEffect(() => {
    if (!job?.id || job.state !== 'running') return undefined;
    const timer = setInterval(async () => {
      try {
        const { job: current } = await api(`/api/tester/job/${job.id}`);
        if (!current) return;
        setJob(current);
        if (current.state === 'done') {
          await loadRun(current.run);
          refreshInfo();
        } else if (current.state === 'error') {
          setMessage(current.error);
        }
      } catch (error) {
        setMessage(error.message);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [job?.id, job?.state, loadRun, refreshInfo]);

  const running = job?.state === 'running';

  const runPhase = async (confirm = false) => {
    setMessage(null);
    if (!rule.codes.length) {
      setMessage('Elige al menos un elemento.');
      return;
    }
    try {
      const response = await api(`/api/tester/run/${symbol}`, { rule: toBackendRule(rule), phase, confirm });
      if (!response.success) {
        setMessage(response.message);
        return;
      }
      if (response.needsConfirm) {
        const gate = response.gate;
        const text = phase === 2
          ? `Fase 2 (validación), del ${response.phase.from} al ${response.phase.to}.\n\nEsta regla exacta se corre una sola vez aquí: el resultado queda guardado y no se recalcula. `
            + `Llevas ${gate.variantsPhase1} variantes probadas en la fase 1 y ${gate.rulesInPhase} reglas distintas corridas en la fase 2.`
            + `${gate.ranPhase1 ? '' : '\n\nEsta regla exacta no se corrió en la fase 1.'}\n\n¿Correrla?`
          : `Fase 3 (final), del ${response.phase.from} al ${response.phase.to}.\n\nEs la última comprobación de esta regla y se corre una sola vez. `
            + `Ya hay ${gate.rulesInPhase} reglas distintas corridas en esta fase.\n\n¿Correrla?`;
        if (window.confirm(text)) await runPhase(true);
        return;
      }
      if (response.run) {
        await loadRun(response.run);
        if (response.stored) setMessage('Esta regla exacta ya se había corrido en esta fase: se muestra el resultado guardado.');
        return;
      }
      setJob({ id: response.job, state: 'running', done: 0, total: 1, stage: 'Elementos del tramo' });
    } catch (error) {
      setMessage(error.message);
    }
  };

  // Tus órdenes manuales (registro del Observador). Aquí no hay hora simulada: se ven todas, de cualquier sesión
  const lastEnd = info?.phases?.length ? Math.max(...info.phases.map(p => p.end)) : null;
  const orderViews = useMemo(() => (myOrders || []).map(order => ({
    order, view: registryChartView(order, { now: Number.MAX_SAFE_INTEGER, symbol, blindActive: false, sessionId: null })
  })).filter(item => !item.view.problem), [myOrders, symbol]);
  useEffect(() => {
    if (tab !== 'ordenes' || myOrders) return;
    api('/api/observer/orders?limit=500')
      .then(data => setMyOrders((data.orders || []).filter(order => order.symbol === symbol && order.status !== 'pending')))
      .catch(error => setMessage(error.message));
  }, [tab, myOrders, symbol]);

  // El gráfico se vuelve a montar al cambiar de marco o de vista: se insiste hasta que pueda ir al punto
  const focusTimer = useRef(null);
  const focusLater = useCallback((time, price) => {
    clearTimeout(focusTimer.current);
    let tries = 0;
    const attempt = () => {
      if (chartRef.current?.focusOn?.(time, price)) return;
      if (tries++ < 40) focusTimer.current = setTimeout(attempt, 150);
    };
    focusTimer.current = setTimeout(attempt, 0);
  }, []);
  useEffect(() => () => clearTimeout(focusTimer.current), []);

  // Cajas de los trades y línea del trade elegido, para el gráfico
  const trades = result?.trades || [];
  const chartOpen = ordersView || phase === 1 || !!revealed[phase];
  useEffect(() => {
    if (ordersView) {
      boxesRef.current = orderViews.map(item => item.view.box).filter(Boolean);
      bandsRef.current = [];
      linesRef.current = orderViews.filter(item => item.order.id === pickedOrder && item.view.line).map(item => item.view.line);
    } else {
      boxesRef.current = chartOpen && result ? tradeBoxes(trades, result.rule.tf) : [];
      const trade = trades.find(t => t.n === selected);
      linesRef.current = chartOpen && trade ? [{ entryTime: trade.entry_t, exitTime: trade.exit_t, tradeNumber: trade.n }] : [];
      // Lo que la regla vio en el trade elegido: zonas de liquidaciones de ese momento y dónde estaba cada elemento
      bandsRef.current = chartOpen && trade ? tradeBands(trade, result.rule.tf, names) : [];
    }
    chartRef.current?.redraw?.();
  }, [result, selected, chartOpen, ordersView, orderViews, pickedOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = useCallback((trade) => {
    setSelected(trade.n);
    setDetail(null);
    setOrdersView(false);
    if (phase === 1 || revealed[phase]) focusLater(trade.entry_t, trade.entry);
    api(`/api/tester/result/${result.id}/trade/${trade.n}`).then(d => d.success && setDetail(d)).catch(noop);
  }, [result, phase, revealed, focusLater]);

  const pickOrder = useCallback(({ order, view }) => {
    setPickedOrder(order.id);
    setOrdersView(true);
    if (CHART_TIMEFRAMES.includes(view.timeframe)) setChartTf(view.timeframe);
    focusLater(view.time, view.price);
  }, [focusLater]);

  const sorted = useMemo(() => sortTrades(trades, sort.key, sort.desc), [trades, sort]);

  // Flechas: trade anterior y siguiente de la lista, como está ordenada
  useEffect(() => {
    const onKey = (event) => {
      if (tab !== 'trades' || !sorted.length || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
      const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0);
      if (!step) return;
      event.preventDefault();
      const index = sorted.findIndex(t => t.n === selected);
      const next = sorted[Math.max(0, Math.min(sorted.length - 1, index + step))];
      if (next) pick(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, sorted, selected, pick]);

  const getTradeBoxes = useCallback(() => boxesRef.current, []);
  const getTradeBands = useCallback(() => bandsRef.current, []);
  const getTradeBoundaries = useCallback(() => linesRef.current, []);
  // Lo que deja ver el gráfico: la fase 1 completa; la 2 y la 3 solo hasta su inicio mientras no se pida verlas
  const chartTime = ordersView && lastEnd ? lastEnd : (phaseInfo ? (chartOpen ? phaseInfo.end : phaseInfo.start) : null);
  const days = useMemo(() => (phaseInfo ? Math.min(Math.ceil((Date.now() - phaseInfo.start) / DAY_MS) + 60, MAX_DAYS[chartTf]) : MAX_DAYS[chartTf]), [phaseInfo, chartTf]);

  const toggleCode = (code) => setRule(previous => {
    const has = previous.codes.includes(code);
    if (!has && previous.codes.length >= MAX_ELEMENTS) return previous;
    const next = { ...previous, codes: has ? previous.codes.filter(c => c !== code) : [...previous.codes, code] };
    // El barrido es contexto: al elegirlo la regla pasa a secuencia, con el gatillo hasta 10 velas después
    if (code === 'LIQ' && !has) Object.assign(next, { mode: 'sequence', first: [...new Set([...(previous.first || []), 'LIQ'])], window: MAX_WINDOW, min: 1 });
    return next;
  });
  const toggleFirst = (code) => patch({ first: (rule.first || []).includes(code) ? rule.first.filter(c => c !== code) : [...(rule.first || []), code] });
  const parts = sequenceParts(rule);
  const liqFrom = info?.liqFrom ? new Date(info.liqFrom).toISOString().slice(0, 10).split('-').reverse().join('/') : null;
  const setFilter = (index, change) => patch({ filters: rule.filters.map((f, i) => (i === index ? { ...f, ...change } : f)) });
  const measureGroups = useMemo(() => {
    const groups = {};
    (info?.measures || []).forEach(m => { (groups[m.group] = groups[m.group] || []).push(m); });
    return groups;
  }, [info]);

  const head = (key, label) => (
    <th className="sort" onClick={() => setSort(s => ({ key, desc: s.key === key ? !s.desc : key !== 'n' }))}>{label}{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}</th>
  );

  // ==================== Pestañas del panel ====================

  const ruleTab = (
    <>
      <div className="rt-group">
        <div className="rt-row">
          <input type="text" value={rule.name} onChange={(e) => patch({ name: e.target.value })} style={{ flex: 1 }} placeholder="Nombre de la regla" />
          <button type="button" className="rt-btn" onClick={() => setSaved(saveRule(rule))} title="Guardar esta regla con su nombre">Guardar</button>
        </div>
        {saved.length > 0 && (
          <div className="rt-row">
            <select value="" onChange={(e) => { const item = saved.find(s => s.name === e.target.value); if (item) setRule({ ...defaultRule(), ...item }); }} style={{ flex: 1 }}>
              <option value="">Cargar una regla guardada…</option>
              {saved.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
            {saved.some(s => s.name === rule.name) && <button type="button" className="rt-btn" onClick={() => setSaved(deleteRule(rule.name))}>Borrar</button>}
          </div>
        )}
      </div>

      <div className="rt-group">
        <h4>Marco de la regla</h4>
        <div className="rt-row">
          {RULE_TIMEFRAMES.map(tf => <button key={tf} type="button" className={`rt-btn${rule.tf === tf ? ' on' : ''}`} onClick={() => patch({ tf })}>{TF_LABEL[tf]}</button>)}
        </div>
      </div>

      <div className="rt-group">
        <h4>Elementos que disparan ({rule.codes.length} de {MAX_ELEMENTS})</h4>
        <div className="rt-chips">
          {(info?.elements || []).map(e => (
            <button key={e.code} type="button" className={`rt-chip${rule.codes.includes(e.code) ? ' on' : ''}`} onClick={() => toggleCode(e.code)}
              disabled={!!info?.storeless && !info.candleCodes.includes(e.code) && !rule.codes.includes(e.code)}
              style={info?.storeless && !info.candleCodes.includes(e.code) ? { opacity: 0.4 } : undefined}
              title={`${e.name}${e.volume ? ' · solo en velas de mucho volumen' : ''}${e.flow ? ' · necesita el almacén de flujo' : ''}${e.code === 'LIQ' ? ' · el precio pasa un swing que coincide con una zona del indicador Liquidaciones' : ''}${e.code === 'VH' ? ' · vela con el doble del volumen normal de su hora, hacia su color' : ''}`}>
              {e.code} {e.name}
            </button>
          ))}
        </div>
        {info?.storeless && (
          <div className="rt-note" style={{ marginTop: 4 }}>
            {symbol} no tiene almacén de trades: la regla corre sobre las velas guardadas y solo valen {info.candleCodes.join(', ')}.
            {rule.codes.some(code => !info.candleCodes.includes(code)) && ' Quita de la regla los demás elementos para poder correrla.'}
          </div>
        )}
        {rule.codes.length > 1 && (
          <div className="rt-row" style={{ marginTop: 6 }}>
            <select value={rule.mode} onChange={(e) => patch({ mode: e.target.value })}>
              <option value="all">Todos</option>
              <option value="atLeast">Al menos</option>
              <option value="sequence">En secuencia: contexto y después gatillo</option>
            </select>
            {rule.mode === 'atLeast' && <Num value={rule.min} min={1} max={rule.codes.length} onChange={(min) => patch({ min })} />}
            <span>{rule.mode === 'sequence' ? 'gatillo hasta' : 'en una ventana de'}</span>
            <Num value={rule.window} min={1} max={MAX_WINDOW} onChange={(window) => patch({ window })} />
            <span>{rule.mode === 'sequence' ? 'velas después' : 'velas'}</span>
          </div>
        )}
        {rule.codes.length > 1 && rule.mode === 'sequence' && (
          <>
            <div className="rt-row">
              <span title="Clic en un elemento para pasarlo de contexto a gatillo o al revés">Contexto (primero, todos):</span>
              {rule.codes.map(code => (
                <button key={code} type="button" className={`rt-chip${(rule.first || []).includes(code) ? ' on' : ''}`} onClick={() => toggleFirst(code)}
                  title={(rule.first || []).includes(code) ? 'Contexto: debe darse primero. Clic para pasarlo a gatillo' : 'Gatillo: dispara la entrada, en la misma vela del contexto o después. Clic para pasarlo a contexto'}>
                  {code}
                </button>
              ))}
            </div>
            {parts.first.length > 0 ? (
              <div className="rt-row">
                <span>Gatillo: al menos</span>
                <Num value={rule.min} min={1} max={parts.trigger.length} onChange={(min) => patch({ min })} />
                <span>de {parts.trigger.join(', ')}</span>
              </div>
            ) : <div className="rt-note">Marca al menos un elemento como contexto y deja otro como gatillo; si no, se piden todos a la vez.</div>}
          </>
        )}
        {rule.codes.includes('LIQ') && (
          <>
            <div className="rt-row">
              <span>Barrido de</span>
              <select value={rule.liqWhat} onChange={(e) => patch({ liqWhat: e.target.value })}
                title="La zona: el precio viene de un lado de la franja de liquidaciones y la pasa entera. Un swing: el precio pasa un máximo o mínimo anterior que está dentro de una franja">
                <option value="zone">la zona de liquidaciones, de lado a lado</option>
                <option value="swing">un swing dentro de una zona</option>
              </select>
            </div>
            <div className="rt-row">
              <select value={rule.liqVariant} onChange={(e) => patch({ liqVariant: e.target.value })}>
                <option value="pierce">Basta pasarla</option>
                <option value="reclaim">La pasa y cierra de vuelta</option>
              </select>
              {rule.liqVariant === 'reclaim' && <><span>en</span><Num value={rule.liqReclaimBars} min={0} max={10} onChange={(liqReclaimBars) => patch({ liqReclaimBars })} /><span>velas</span></>}
              {rule.liqWhat === 'swing' && <><span>· swing de</span><Num value={rule.liqSwingBars} min={2} max={20} onChange={(liqSwingBars) => patch({ liqSwingBars })} /><span>velas por lado</span></>}
            </div>
            <div className="rt-note">
              {rule.liqWhat === 'swing' ? 'Barrer un mínimo con liquidaciones es alcista; un máximo, bajista. ' : 'Bajar a través de una zona es alcista; subir a través de ella, bajista. La zona debe existir con el precio fuera de ella antes del barrido. '}
              Al elegir un trade, el gráfico dibuja las zonas que había en su barrido (la barrida, resaltada). El indicador Liquidaciones, en cambio, muestra las del final de la fase. {liqFrom ? `Hay liquidaciones desde el ${liqFrom}: antes no sale ningún barrido. ` : 'Este símbolo no tiene liquidaciones descargadas. '}
              Para el stop detrás del barrido usa "Extremo de la vela del elemento".
            </div>
          </>
        )}
        <div className="rt-row" style={{ marginTop: 6 }}>
          <span>Lado</span>
          <select value={rule.side} onChange={(e) => patch({ side: e.target.value })}>
            <option value="both">Alcistas y bajistas</option>
            <option value="long">Solo alcistas</option>
            <option value="short">Solo bajistas</option>
          </select>
          <Check checked={rule.invert} onChange={(invert) => patch({ invert })} title="Operar en contra del elemento: un elemento alcista abre un corto">Invertir</Check>
        </div>
        {rule.codes.includes('CC') && (
          <>
            <div className="rt-row">
              <span title="Las velas con que se arma la tendencia. Pueden ser mayores que las de la regla: la entrada y el stop se siguen en las velas de la regla">Estructura en velas de</span>
              <select value={rule.ccTf} onChange={(e) => patch({ ccTf: Number(e.target.value) })}>
                {CC_STRUCT_TFS.filter(([minutes]) => minutes === 0 || (minutes > rule.tf && minutes % rule.tf === 0)).map(([minutes, label]) => <option key={minutes} value={minutes}>{label}</option>)}
              </select>
              {rule.ccTf >= 240 && (
                <>
                  <span>contadas desde las</span>
                  <select value={rule.ccOffset} onChange={(e) => patch({ ccOffset: Number(e.target.value) })}>
                    {CC_OFFSETS.map(([minutes, label]) => <option key={minutes} value={minutes}>{label}</option>)}
                  </select>
                </>
              )}
            </div>
            <div className="rt-row">
              <span>Swing de</span><Num value={rule.ccSwing} min={2} max={20} onChange={(ccSwing) => patch({ ccSwing })} /><span>velas por lado ·</span>
              <span title="Cuántos máximos y cuántos mínimos seguidos deben ir en la misma dirección">tendencia de</span>
              <Num value={rule.ccLegs} min={2} max={5} onChange={(ccLegs) => patch({ ccLegs })} /><span>tramos</span>
            </div>
            <div className="rt-note">
              CC: una tendencia de máximos y mínimos crecientes y una vela que cierra bajo su último mínimo abre un corto (al revés, un largo). "Invertir" opera a favor de la tendencia.
              Para el stop detrás del extremo de la tendencia usa "Borde lejano de la zona" y sube el "Máximo" del stop: con la estructura en 4 horas queda a muchos ATR de las velas de la regla.
            </div>
          </>
        )}
        <div className="rt-row">
          <Check checked={rule.useHours} onChange={(useHours) => patch({ useHours })} title="Solo se operan las señales que se conocen entre esas horas, en UTC. La hora es la del cierre de la vela de la señal, que es cuando se entra">Solo señales entre las</Check>
          <input type="text" value={rule.hoursFrom} disabled={!rule.useHours} onChange={(e) => patch({ hoursFrom: e.target.value })} style={{ width: 56 }} placeholder="17:30" />
          <span>y las</span>
          <input type="text" value={rule.hoursTo} disabled={!rule.useHours} onChange={(e) => patch({ hoursTo: e.target.value })} style={{ width: 56 }} placeholder="21:30" />
          <span>UTC</span>
          <Check checked={rule.hoursWeekdays} onChange={(hoursWeekdays) => patch({ hoursWeekdays })}>lunes a viernes</Check>
        </div>
        {rule.useHours && (minuteOfDay(rule.hoursFrom) === null || minuteOfDay(rule.hoursTo) === null) && <div className="rt-note">Escribe las horas como 17:30. Mientras no sean válidas, el horario no se aplica.</div>}
        {rule.useHours && <div className="rt-note">Sesión de Nueva York: de 13:30 a 20:00 UTC en verano y de 14:30 a 21:00 en invierno. Con velas de 4 horas contadas desde las 13:30, las que cierran dentro de la sesión se conocen a las 17:30 y a las 21:30.</div>}
        {usesProfile(rule) && (
          <>
            <div className="rt-row">
              <span title="La sesión cuyo perfil se usa: siempre la anterior ya cerrada. Las sesiones van en UTC">Perfil de</span>
              <select value={rule.vpHours} onChange={(e) => patch({ vpHours: Number(e.target.value) })}>
                {VP_PERIODS.map(([hours, label]) => <option key={hours} value={hours}>{label}</option>)}
              </select>
              <span title="VR: minutos seguidos cerrando dentro del valor. VX: minutos seguidos cerrando fuera">· sostenido</span>
              <Num value={rule.vpAccept} min={5} max={480} step={5} onChange={(vpAccept) => patch({ vpAccept })} /><span>min</span>
              <span title="VF: velas que tiene el precio para cerrar de vuelta dentro del valor después de salir">· fallo en</span>
              <Num value={rule.vpFailBars} min={1} max={20} onChange={(vpFailBars) => patch({ vpFailBars })} /><span>velas</span>
            </div>
            <div className="rt-row">
              <span title="Solo se operan las sesiones cuya sesión anterior tuvo una de estas formas. Sin marcar ninguna, todas">Forma del perfil anterior:</span>
              {VP_SHAPES.map(([shape, label]) => (
                <button key={shape} type="button" className={`rt-chip${(rule.vpShapes || []).includes(shape) ? ' on' : ''}`} title={label}
                  onClick={() => patch({ vpShapes: (rule.vpShapes || []).includes(shape) ? rule.vpShapes.filter(s => s !== shape) : [...(rule.vpShapes || []), shape] })}>
                  {shape}
                </button>
              ))}
              <span className="rt-note">{(rule.vpShapes || []).length ? '' : 'todas'}</span>
            </div>
            {rule.codes.includes('VE') && (
              <div className="rt-row">
                <span title="VE: la sesión abre dentro del valor anterior y el precio llega a un borde. Compra en el VAL, vende en el VAH">VE entra:</span>
                <select value={rule.vpVeEntry} onChange={(e) => patch({ vpVeEntry: e.target.value })}>
                  <option value="touch">tras el primer toque del borde</option>
                  <option value="resting">con una orden limit esperando en cada borde toda la sesión</option>
                </select>
              </div>
            )}
            {rule.codes.includes('VE') && rule.vpVeEntry === 'resting' && (
              <div className="rt-note">Con la orden esperando, la entrada es siempre limit en el borde del valor y vale hasta que termina la sesión: lo elegido en "Entrada" no cuenta. Se opera la orden que se llene primero.</div>
            )}
            <div className="rt-note">
              Todo se mide contra el POC, el VAH y el VAL de la sesión anterior, con volumen real. VR: abre fuera del valor y vuelve a sostenerse dentro (va al borde contrario).
              VF: sale del valor y cierra de vuelta dentro (va al POC). VX: se sostiene fuera (sigue la salida). VE: abre dentro y llega a un borde (compra en el VAL, vende en el VAH; pensado para perfiles D). Para el stop detrás del extremo usa "Borde lejano de la zona".
            </div>
          </>
        )}
        {rule.codes.includes('VA') && (
          <div className="rt-row">
            <span title="La regla del libro cuenta cualquier vela que no toque el área de valor de la anterior, aunque quede a un tick. Con un hueco mínimo solo cuentan las que se alejan de verdad. 0 = regla literal">VA abandonada: hueco mínimo</span>
            <Num value={rule.vaGap} min={0} max={5} step={0.05} onChange={(vaGap) => patch({ vaGap })} /><span>ATR</span>
          </div>
        )}
        <div className="rt-row">
          <Check checked={rule.swing} onChange={(swing) => patch({ swing })} title="La señal debe darse en un mínimo (alcista) o máximo (bajista) de N velas">En un extremo de</Check>
          <Num value={rule.swingBars} min={2} max={20} disabled={!rule.swing} onChange={(swingBars) => patch({ swingBars })} /><span>velas</span>
          <Check checked={rule.momentum} onChange={(momentum) => patch({ momentum })} title="EMA 14 con pendiente a favor y el precio de su lado">Momentum</Check>
        </div>
        <div className="rt-row">
          <Check checked={rule.confirm} onChange={(confirm) => patch({ confirm })} title="La señal vale cuando el precio avanza a favor">Confirmar con</Check>
          <Num value={rule.confirmAtr} min={0.05} max={3} step={0.05} disabled={!rule.confirm} onChange={(confirmAtr) => patch({ confirmAtr })} /><span>ATR a favor en</span>
          <Num value={rule.confirmBars} min={1} max={5} disabled={!rule.confirm} onChange={(confirmBars) => patch({ confirmBars })} /><span>velas</span>
        </div>
      </div>

      <div className="rt-group">
        <h4>Entrada</h4>
        <div className="rt-row">
          <select value={rule.entryType} onChange={(e) => patch({ entryType: e.target.value })}>
            <option value="market">A mercado, en la apertura de la vela siguiente</option>
            <option value="limit">Limit en la zona del elemento</option>
          </select>
        </div>
        {rule.entryType === 'limit' && (
          <div className="rt-row">
            <select value={rule.entryAt} onChange={(e) => patch({ entryAt: e.target.value })}>
              <option value="near">Borde cercano</option>
              <option value="mid">Mitad de la zona</option>
              <option value="far">Borde lejano</option>
            </select>
            <span>vence en</span><Num value={rule.entryExpiry} min={1} max={200} onChange={(entryExpiry) => patch({ entryExpiry })} /><span>velas</span>
          </div>
        )}
      </div>

      <div className="rt-group">
        <h4>Stop</h4>
        <div className="rt-row">
          <select value={rule.stopType} onChange={(e) => patch({ stopType: e.target.value })}>
            <option value="swing">Swing anterior a la señal</option>
            <option value="candle">Extremo de la vela del elemento</option>
            <option value="zone">Borde lejano de la zona</option>
            <option value="atr">Distancia en ATR</option>
          </select>
          {rule.stopType === 'swing' && <><Num value={rule.stopBars} min={2} max={20} onChange={(stopBars) => patch({ stopBars })} /><span>velas por lado</span></>}
          {rule.stopType === 'atr' && <><Num value={rule.stopAtr} min={0.1} max={20} step={0.1} onChange={(stopAtr) => patch({ stopAtr })} /><span>ATR</span></>}
        </div>
        <div className="rt-row">
          {rule.stopType !== 'atr' && <><span>Margen</span><Num value={rule.stopBuffer} min={0} max={5} step={0.05} onChange={(stopBuffer) => patch({ stopBuffer })} /><span>ATR</span></>}
          <span title="Una señal con el stop más lejos no se opera">Máximo</span><Num value={rule.stopMaxAtr} min={0.2} max={100} step={0.5} onChange={(stopMaxAtr) => patch({ stopMaxAtr })} /><span>ATR</span>
        </div>
      </div>

      <div className="rt-group">
        <h4>Salida</h4>
        <div className="rt-row">
          <Check checked={rule.useTarget} onChange={(useTarget) => patch({ useTarget })} title="Sin marcar no hay objetivo: se ve hasta dónde llega">Objetivo</Check>
          {usesProfile(rule) && (
            <select value={rule.targetAt} disabled={!rule.useTarget} onChange={(e) => patch({ targetAt: e.target.value })} title="Dónde va el objetivo">
              <option value="r">en R</option>
              <option value="poc">en el POC anterior</option>
              <option value="edge">en el borde contrario del valor</option>
              <option value="mid">en el centro del rango anterior</option>
            </select>
          )}
          {!(usesProfile(rule) && rule.targetAt !== 'r') && <><Num value={rule.targetR} min={0.2} max={50} step={0.25} disabled={!rule.useTarget} onChange={(targetR) => patch({ targetR })} /><span>R</span></>}
          <Check checked={rule.trail} onChange={(trail) => patch({ trail })} title="El stop sube al último swing confirmado a favor">Arrastrar el stop por swings de</Check>
          <Num value={rule.trailBars} min={2} max={20} disabled={!rule.trail} onChange={(trailBars) => patch({ trailBars })} />
        </div>
        <div className="rt-row">
          <Check checked={rule.useHorizon} onChange={(useHorizon) => patch({ useHorizon })}>Cerrar a las</Check>
          <Num value={rule.horizon} min={1} max={2000} disabled={!rule.useHorizon} onChange={(horizon) => patch({ horizon })} /><span>velas</span>
          <Check checked={rule.opposite} onChange={(opposite) => patch({ opposite })}>Cerrar con la señal contraria</Check>
        </div>
        {!rule.useTarget && !rule.trail && !rule.useHorizon && <div className="rt-note">Sin objetivo hace falta otra salida: se cerrará a las 96 velas.</div>}
        <div className="rt-row">
          <Check checked={rule.oneAtATime} onChange={(oneAtATime) => patch({ oneAtATime })} title="Marcado: lo que operarías. Sin marcar: todas las señales, para medir el elemento">Una posición a la vez</Check>
          <span title="Velas de espera después de cerrar un trade antes de tomar otra señal. 0 = sin espera">Esperar</span>
          <Num value={rule.cooldown} min={0} max={500} disabled={!rule.oneAtATime} onChange={(cooldown) => patch({ cooldown })} /><span>velas tras cerrar</span>
        </div>
      </div>

      <div className="rt-group">
        <h4>Filtros de contexto (medidas del Observador)</h4>
        {rule.filters.map((filter, index) => (
          <div className="rt-row" key={index}>
            <select value={filter.key} onChange={(e) => setFilter(index, { key: e.target.value })} style={{ maxWidth: 220 }}>
              <option value="">Medida…</option>
              {Object.entries(measureGroups).map(([group, items]) => (
                <optgroup key={group} label={group}>{items.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</optgroup>
              ))}
            </select>
            <select value={filter.op} onChange={(e) => setFilter(index, { op: e.target.value })}><option value=">=">≥</option><option value="<=">≤</option></select>
            <Num value={filter.value} step={0.1} onChange={(value) => setFilter(index, { value })} />
            <button type="button" className="rt-btn" onClick={() => patch({ filters: rule.filters.filter((_, i) => i !== index) })}>×</button>
          </div>
        ))}
        {rule.filters.length < MAX_FILTERS && <button type="button" className="rt-btn" onClick={() => patch({ filters: [...rule.filters, { key: '', op: '>=', value: 0 }] })}>+ Filtro</button>}
        <div className="rt-note" style={{ marginTop: 4 }}>Cada medida se lee a favor del trade, al cierre de la vela de la señal.</div>
      </div>

      <div className="rt-group">
        <h4>Detección de los elementos</h4>
        <div className="rt-row">
          <span title="Para los elementos marcados 'vol.': volumen de la vela en veces la mediana de las 20 anteriores">Filtro de volumen</span>
          <Num value={rule.volFilter} min={0} max={10} step={0.5} onChange={(volFilter) => patch({ volFilter })} />
          <span title="Parte de las velas que marca cada elemento relativo">Frecuencia</span>
          <Num value={rule.target} min={0.005} max={0.3} step={0.005} onChange={(target) => patch({ target })} />
        </div>
        <div className="rt-note">Cambiar estos dos obliga a detectar de nuevo los elementos de toda la fase (varios minutos).</div>
      </div>
    </>
  );

  const s = result?.summary;
  const summaryTab = !result ? <div className="rt-note">Todavía no hay una corrida de esta fase. Arma la regla y córrela.</div> : (
    <>
      <div className="rt-group">
        <b>{result.rule.name}</b> · Fase {result.phase} · {result.from} a {result.to}
        <div className="rt-note">{describeRule(result.rule)}</div>
      </div>
      {result.phase > 1 && (
        <div className="rt-warn">
          Esta fase es de comprobación. Si cambias la regla por lo que veas aquí, la fase queda gastada para la regla nueva.
          Variantes probadas en la fase 1: {result.gate?.variantsPhase1 ?? '—'}.
        </div>
      )}
      {!s?.n ? <div className="rt-note">La regla no dejó trades cerrados en esta fase ({result.signals} señales).</div> : (
        <>
          {s.smallSample && <div className="rt-warn">Muestra pequeña ({s.n} trades): con menos de 30 nada se distingue del azar.</div>}
          <div className="rt-cards">
            <div className="rt-card"><b>{s.n}</b><span>Trades cerrados</span></div>
            <div className="rt-card"><b>{fmtPct(s.winRate)}</b><span>Acierto ({s.wilson?.[0]}–{s.wilson?.[1]}%)</span></div>
            <div className="rt-card"><b><R value={s.avgR} digits={3} /></b><span>R medio neto</span></div>
            <div className="rt-card"><b><R value={s.totalR} /></b><span>R total</span></div>
            <div className="rt-card"><b>{s.profitFactor ?? '—'}</b><span>Profit factor</span></div>
            <div className="rt-card"><b>{s.maxDrawdownR} R</b><span>Mayor caída</span></div>
            <div className="rt-card"><b>{s.bestStreak} / {s.worstStreak}</b><span>Racha ganadora / perdedora</span></div>
            <div className="rt-card"><b>{s.medianMfe} / {s.medianMae}</b><span>Mediana a favor / en contra (R)</span></div>
            <div className="rt-card"><b>{s.avgBars}</b><span>Velas por trade</span></div>
          </div>
          <Equity points={result.equity} />
          {result.baseline?.n > 0 && (
            <div className="rt-group">
              <h4>Contra el azar</h4>
              <table className="rt-table">
                <thead><tr><th></th><th>Trades</th><th>Acierto</th><th>R medio</th></tr></thead>
                <tbody>
                  <tr><td>La regla</td><td>{s.n}</td><td>{fmtPct(s.winRate)}</td><td><R value={s.avgR} digits={3} /></td></tr>
                  <tr><td>Entradas al azar</td><td>{result.baseline.n}</td><td>{fmtPct(result.baseline.winRate)}</td><td><R value={result.baseline.avgR} digits={3} /></td></tr>
                </tbody>
              </table>
              {result.edge && (
                <div className="rt-note">
                  Ventaja: <R value={result.edge.r} digits={3} /> R por trade (entre {fmtR(result.edge.low, 3)} y {fmtR(result.edge.high, 3)}).{' '}
                  {result.edge.clear ? 'El margen no incluye el cero.' : 'No se distingue del azar.'} Las entradas al azar usan el mismo stop (si depende del elemento, su distancia mediana en ATR), la misma salida y la misma proporción de largos y cortos.
                </div>
              )}
            </div>
          )}
          {s.reach && (
            <div className="rt-group">
              <h4>Hasta dónde llegó antes del stop inicial</h4>
              <table className="rt-table">
                <thead><tr><th></th>{Object.keys(s.reach).map(level => <th key={level}>≥ {level}R</th>)}<th>Mediana</th></tr></thead>
                <tbody>
                  <tr><td>La regla</td>{Object.values(s.reach).map((v, i) => <td key={i}>{fmtPct(v)}</td>)}<td>{s.medianReach} R</td></tr>
                  {result.baseline?.reach && <tr><td>Al azar</td>{Object.values(result.baseline.reach).map((v, i) => <td key={i}>{fmtPct(v)}</td>)}<td>{result.baseline.medianReach} R</td></tr>}
                </tbody>
              </table>
              <div className="rt-note">No depende del objetivo elegido: mira {s.reachN} trades durante 300 velas o hasta tocar el stop inicial.</div>
            </div>
          )}
        </>
      )}
      {result.vpControl && (
        <div className="rt-group">
          <h4>¿Aporta el perfil?</h4>
          <div className="rt-note">
            La misma regla con los perfiles desplazados al azar (cada sesión movida entre 30% y 100% de su rango, {result.vpControl.runs} corridas juntas):
            {' '}{result.vpControl.n ?? 0} trades{result.vpControl.n ? <>, acierto {fmtPct(result.vpControl.winRate)}, <R value={result.vpControl.avgR} digits={3} /> R por trade</> : null}.
            {result.vpControl.edge && <> Diferencia a favor del perfil real: <R value={result.vpControl.edge.r} digits={3} /> R (de {result.vpControl.edge.low} a {result.vpControl.edge.high}). {result.vpControl.edge.clear ? 'Se distingue: el lugar del volumen importa.' : 'No se distingue: con niveles puestos en cualquier parte da lo mismo.'}</>}
          </div>
        </div>
      )}
      {result.control && (
        <div className="rt-group">
          <h4>¿Aportan las liquidaciones?</h4>
          <div className="rt-note">
            La misma regla tras barrer un swing <b>sin</b> liquidaciones: {result.control.n ?? 0} trades{result.control.n ? <>, acierto {fmtPct(result.control.winRate)}, <R value={result.control.avgR} digits={3} /> R por trade</> : null}.
            {result.control.edge && <> Diferencia a favor de las liquidaciones: <R value={result.control.edge.r} digits={3} /> R (de {result.control.edge.low} a {result.control.edge.high}). {result.control.edge.clear ? 'Se distingue.' : 'No se distingue de un barrido cualquiera.'}</>}
            {result.liqFrom && <> Liquidaciones desde el {result.liqFrom.split('-').reverse().join('/')}.</>}
          </div>
        </div>
      )}
      <div className="rt-group">
        <h4>Señales</h4>
        <div className="rt-note">
          {result.signals} señales en {result.bars.toLocaleString('es-CO')} velas. {result.busy > 0 && `${result.busy} con una posición ya abierta. `}
          {Object.entries(result.skipped || {}).map(([why, count]) => `${count} sin operar por ${why}. `)}
          {result.open > 0 && `${result.open} seguían abiertas al final de la fase y no cuentan. `}
          {!result.measuresAvailable && 'Sin tabla de medidas para este símbolo: los trades no llevan medidas.'}
        </div>
      </div>
      <div className="rt-row">
        <a className="rt-btn" href={`${API_BASE_URL}/api/tester/result/${result.id}/csv`} style={{ textDecoration: 'none' }}>Descargar CSV</a>
        {result.phase === 1 && <button type="button" className="rt-btn" disabled={sens === 'loading'} onClick={async () => {
          setSens('loading');
          try {
            const response = await api(`/api/tester/sensitivity/${symbol}`, { rule: result.rule });
            setSens(response.success ? response.rows : null);
            if (!response.success) setMessage(response.message);
          } catch (error) {
            setSens(null);
            setMessage(error.message);
          }
        }}>{sens === 'loading' ? 'Calculando…' : 'Sensibilidad'}</button>}
      </div>
      {Array.isArray(sens) && (
        <div className="rt-group" style={{ marginTop: 8 }}>
          <h4>Sensibilidad (valores vecinos)</h4>
          <table className="rt-table">
            <thead><tr><th></th><th>Trades</th><th>Acierto</th><th>R medio</th><th>R total</th></tr></thead>
            <tbody>
              {sens.map(row => <tr key={row.label} className={row.current ? 'sel' : ''}><td>{row.label}</td><td>{row.n}</td><td>{fmtPct(row.winRate)}</td><td><R value={row.avgR} digits={3} /></td><td><R value={row.totalR} /></td></tr>)}
            </tbody>
          </table>
          <div className="rt-note">Una regla que solo gana con un valor exacto es frágil.</div>
        </div>
      )}
    </>
  );

  const selectedTrade = trades.find(t => t.n === selected);
  const tradesTab = !result ? <div className="rt-note">Sin corrida en esta fase.</div> : (
    <>
      {selectedTrade && (
        <div className="rt-group">
          <b>Trade {selectedTrade.n}</b> · {selectedTrade.dir > 0 ? 'Largo' : 'Corto'} · <R value={selectedTrade.r} /> R · {selectedTrade.reason}
          <div className="rt-note">
            Señal {stamp(selectedTrade.signal)} · entrada {stamp(selectedTrade.entry_t)} ({selectedTrade.order === 'limit' ? 'limit' : 'mercado'}) · salida {stamp(selectedTrade.exit_t)}<br />
            Entrada {selectedTrade.entry} · stop {Number(selectedTrade.stop.toFixed(6))} ({selectedTrade.stop_atr} ATR){selectedTrade.target != null && ` · objetivo ${Number(selectedTrade.target.toFixed(6))}`} · salida {Number(selectedTrade.exit.toFixed(6))}<br />
            Elementos de la regla: {selectedTrade.votes.join(' ')} · presentes: {selectedTrade.present.join(' ') || '—'} · en contra: {selectedTrade.against.join(' ') || '—'}
            {selectedTrade.vp && <><br />Sesión anterior ({selectedTrade.vp.hours} h): VAH {selectedTrade.vp.vah} · POC {selectedTrade.vp.poc} · VAL {selectedTrade.vp.val} · perfil {selectedTrade.vp.shape || '—'} · la sesión abrió {selectedTrade.vp.open > 0 ? 'encima del valor' : selectedTrade.vp.open < 0 ? 'debajo del valor' : 'dentro del valor'}</>}
            {selectedTrade.cc && <><br />Cambio de carácter: swing roto en {selectedTrade.cc.level}, extremo de la tendencia en {selectedTrade.cc.extreme}, estructura en velas de {selectedTrade.cc.structTf >= 60 ? `${selectedTrade.cc.structTf / 60} h` : `${selectedTrade.cc.structTf} m`}</>}
            {selectedTrade.liq && <><br />Barrido: {selectedTrade.liq.what === 'zone' ? `zona ${selectedTrade.liq.zoneLow}–${selectedTrade.liq.zoneHigh}` : `swing en ${selectedTrade.liq.swing} de hace ${selectedTrade.liq.swingAgeBars} velas`}, pasado hasta {selectedTrade.liq.extreme}{selectedTrade.liq.depthAtr != null && ` (${selectedTrade.liq.depthAtr} ATR)`} · zona de {Math.round((selectedTrade.liq.usd || 0) / 1000).toLocaleString('es-CO')}K USD ({selectedTrade.liq.zoneSide === 'long' ? 'largos' : 'cortos'} liquidados), última liquidación {selectedTrade.liq.zoneAgeDays} días antes · {selectedTrade.liq.source}</>}
          </div>
          {detail?.trade?.n === selectedTrade.n && detail.measures.length > 0 && (
            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: 'pointer' }}>Medidas al decidir ({detail.measures.length})</summary>
              <table className="rt-table">
                <tbody>{detail.measures.map(m => <tr key={m.key}><td>{m.group} · {m.label}</td><td>{m.value ?? '—'}</td></tr>)}</tbody>
              </table>
            </details>
          )}
        </div>
      )}
      <div className="rt-note" style={{ marginBottom: 4 }}>Clic en un trade para verlo en el gráfico. Las flechas del teclado pasan al siguiente.</div>
      <table className="rt-table">
        <thead>
          <tr>{head('n', '#')}{head('entry_t', 'Entrada')}{head('dir', 'Lado')}{head('r', 'R')}{head('mfe', 'A favor')}{head('mae', 'En contra')}{head('reach', 'Alcance')}{head('bars', 'Velas')}{head('reason', 'Salida')}{head('votes', 'Elem.')}</tr>
        </thead>
        <tbody>
          {sorted.slice(0, shown).map(t => (
            <tr key={t.n} className={`pick${t.n === selected ? ' sel' : ''}`} onClick={() => pick(t)}>
              <td>{t.n}</td><td>{stamp(t.entry_t)}</td><td>{t.dir > 0 ? 'L' : 'C'}</td><td><R value={t.r} /></td><td>{t.mfe}</td><td>{t.mae}</td>
              <td>{t.reach ?? '—'}</td><td>{t.bars}</td><td>{t.reason}</td><td>{t.votes.join(' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > shown && <button type="button" className="rt-btn" onClick={() => setShown(n => n + PAGE)}>Mostrar {Math.min(PAGE, sorted.length - shown)} más ({sorted.length - shown} restantes)</button>}
    </>
  );

  const b = result?.breakdowns;
  const wl = result?.winnersVsLosers;
  const patternsTab = !result || !s?.n ? <div className="rt-note">Sin trades en esta fase.</div> : (
    <>
      <BriefTable title="Por año" rows={b.year} />
      <BriefTable title="Por lado" rows={b.side} />
      <BriefTable title="Por hora de entrada (UTC)" rows={b.hour} />
      <BriefTable title="Por salida" rows={b.reason} />
      <BriefTable title="Por forma del perfil de la sesión anterior" rows={b.vpShape} first="D medio · P arriba · b abajo · B doble" />
      <BriefTable title="Por forma del perfil y lado" rows={b.vpShapeSide} />
      <BriefTable title="Por apertura de la sesión frente al valor anterior" rows={b.vpOpen} />
      <BriefTable title="Por combinación de elementos de la regla" rows={b.combo} />
      <SplitTable title="Aporte de cada elemento de la regla" rows={b.ruleElements} names={names} />
      <SplitTable title="Otros elementos presentes, a favor del trade" rows={b.otherElements} names={names} note="Elementos que no están en la regla y aparecieron en la ventana de la señal. Ordenados por diferencia de R." />
      <SplitTable title="Elementos en contra del trade" rows={b.againstElements} names={names} />
      <div className="rt-group">
        <h4>Medidas: ganadores contra perdedores</h4>
        {!wl ? <div className="rt-note">Faltan trades con medidas (al menos 5 ganadores y 5 perdedores).</div> : (
          <>
            <table className="rt-table">
              <thead><tr><th>Medida</th><th>Ganadores</th><th>Perdedores</th><th>Separa</th></tr></thead>
              <tbody>
                {wl.rows.map(row => (
                  <tr key={row.key} style={{ fontWeight: row.clear ? 600 : 400 }} title={row.clear ? 'Supera lo que da el azar al mirar todas las medidas' : ''}>
                    <td>{row.group} · {row.label}</td><td>{row.first_median}</td><td>{row.second_median}</td><td>{(row.share * 100).toFixed(0)}%{row.clear ? ' ●' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="rt-note">Mediana de cada grupo. "Separa" es en cuántos pares ganador-perdedor el ganador tiene el valor mayor: 50% es no distinguirlos. ● supera el umbral del azar ({wl.threshold}). En la fase 1 sirve para proponer un filtro; hay que comprobarlo en la fase 2.</div>
          </>
        )}
      </div>
    </>
  );

  const historyTab = (
    <>
      <div className="rt-note" style={{ marginBottom: 6 }}>
        Cada corrida queda registrada. Variantes distintas probadas en la fase 1: <b>{info?.variantsPhase1 ?? 0}</b>. Con muchas variantes, la mejor se ve bien por azar.
      </div>
      <table className="rt-table">
        <thead><tr><th>Regla</th><th>Fase</th><th>Trades</th><th>R medio</th><th>Ventaja</th><th></th></tr></thead>
        <tbody>
          {(info?.runs || []).map(run => (
            <tr key={run.id} title={describeRule(run.rule)}>
              <td>{run.name}<br /><span className="rt-note">{TF_LABEL[run.tf]} · {new Date(run.at).toLocaleDateString('es-CO')}</span></td>
              <td>{run.phase}</td><td>{run.summary?.n ?? 0}</td><td><R value={run.summary?.avgR} digits={3} /></td><td><R value={run.edge?.r} digits={3} /></td>
              <td>
                <button type="button" className="rt-btn" onClick={() => loadRun(run.id)}>Ver</button>{' '}
                <button type="button" className="rt-btn" onClick={() => { setRule(fromBackendRule(run.rule)); setTab('regla'); }} title="Cargar esta regla en el editor">Regla</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!info?.runs?.length && <div className="rt-note">Sin corridas todavía.</div>}
    </>
  );

  const STATUS = { closed: 'cerrada', open: 'abierta', cancelled: 'cancelada' };
  const ordersTab = (
    <>
      <div className="rt-note" style={{ marginBottom: 6 }}>
        Tus órdenes manuales de {symbol}, de todas las sesiones (registro del Observador). Aquí no hay hora simulada: un clic las muestra en el gráfico, sea cual sea su fecha.
      </div>
      {ordersView && (
        <div className="rt-warn">
          El gráfico muestra tus órdenes sobre todo el histórico, también las fechas de las fases 2 y 3.{' '}
          <button type="button" className="rt-btn" onClick={() => setOrdersView(false)}>Volver a la fase {phase}</button>
        </div>
      )}
      {!ordersView && orderViews.length > 0 && (
        <div className="rt-note" style={{ marginBottom: 6 }}>Al elegir una, el gráfico deja la fase y muestra el histórico completo, incluidas las fechas de las fases 2 y 3.</div>
      )}
      {!myOrders && <div className="rt-note">Leyendo el registro…</div>}
      {myOrders && orderViews.length === 0 && <div className="rt-note">No hay órdenes de {symbol} en el registro.</div>}
      {orderViews.length > 0 && (
        <table className="rt-table">
          <thead><tr><th>#</th><th>Entrada</th><th>Marco</th><th>Lado</th><th>Estado</th><th>R</th></tr></thead>
          <tbody>
            {orderViews.map(item => (
              <tr key={item.order.id} className={`pick${ordersView && item.order.id === pickedOrder ? ' sel' : ''}`} onClick={() => pickOrder(item)}>
                <td>{item.order.trade_number ?? item.order.order_number ?? ''}</td><td>{stamp(item.view.time)}</td><td>{item.order.timeframe}</td>
                <td>{item.order.side === 'short' ? 'C' : 'L'}</td>
                <td>{STATUS[item.order.status] || item.order.status}</td>
                <td style={{ color: tone(item.order.r) }}>{item.order.status === 'closed' && item.order.r !== null && item.order.r !== undefined ? formatR(item.order.r) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );

  const tabs = [['regla', 'Regla'], ['resumen', 'Resumen'], ['trades', `Trades${trades.length ? ` ${trades.length}` : ''}`], ['patrones', 'Patrones'], ['historial', 'Historial'], ['ordenes', 'Mis órdenes']];
  const enabledCount = Object.values(indicatorStates).filter(Boolean).length;

  return (
    <div className="rt-root">
      <div className="rt-head">
        <a className="rt-btn" href={window.location.pathname} title="Volver al menú de inicio de App 1" style={{ textDecoration: 'none' }}>← Inicio</a>
        {info?.symbols?.length > 1 ? (
          <select value={symbol} title="Moneda. Solo BTC tiene los elementos de order flow; en las demás valen CC, VH y LIQ"
            onChange={(e) => { window.location.search = `?${TESTER_PARAM}=1&symbol=${e.target.value}`; }} style={{ fontWeight: 600 }}>
            {[...new Set([symbol, ...info.symbols])].map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        ) : <strong>{symbol}</strong>}
        <span style={{ opacity: 0.7 }}>Backtesting global</span>
        <div style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
          {(info?.phases || []).map(p => (
            <button key={p.phase} type="button" className={`rt-btn${p.phase === phase ? ' on' : ''}`} disabled={!p.available || running}
              title={p.available ? `${p.name}: ${p.from} a ${p.to}` : 'El almacén de trades no cubre esta fase'} onClick={() => { setPhase(p.phase); setOrdersView(false); setSelected(null); setDetail(null); setSens(null); }}>
              Fase {p.phase} · {p.name}
            </button>
          ))}
        </div>
        {phaseInfo && <span className="rt-note">{phaseInfo.from} a {phaseInfo.to}</span>}
        <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
          {CHART_TIMEFRAMES.map(tf => <button key={tf} type="button" className={`rt-btn${tf === chartTf ? ' on' : ''}`} onClick={() => setChartTf(tf)} title="Marco del gráfico (el de la regla se elige en la regla)">{tf.toUpperCase()}</button>)}
        </div>
        <div style={{ position: 'relative' }}>
          <button type="button" className="rt-btn" onClick={() => setShowList(open => !open)}>Indicadores {enabledCount}</button>
          {showList && (
            <div className="rt-menu" style={{ left: 'auto', right: 0 }}>
              {INDICATORS.map(name => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', padding: '3px 0' }}>
                  <label style={{ flex: 1, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!indicatorStates[name]} onChange={() => setIndicatorStates(previous => ({ ...previous, [name]: !previous[name] }))} style={{ marginRight: 8 }} />{name}
                  </label>
                  {WITH_SETTINGS.has(name) && (
                    <button
                      type="button"
                      title={indicatorStates[name] ? `Ajustes de ${name}` : `Enciende ${name} para abrir sus ajustes`}
                      disabled={!indicatorStates[name]}
                      onClick={() => { setShowList(false); setSettingsFor(name); }}
                      style={{ border: 'none', background: 'transparent', cursor: indicatorStates[name] ? 'pointer' : 'default', fontSize: 14, padding: '0 4px', opacity: indicatorStates[name] ? 1 : 0.35 }}
                    >
                      ⚙️
                    </button>
                  )}
                </div>
              ))}
              <div className="rt-note" style={{ marginTop: 6 }}>⚙️ abre los ajustes de cada indicador. Son los mismos de la simulación manual: lo que cambies aquí vale también allá.</div>
            </div>
          )}
        </div>
      </div>

      <div className="rt-body">
        <div className="rt-side">
          <div className="rt-tabs">
            {tabs.map(([key, label]) => <button key={key} type="button" className={`rt-tab${tab === key ? ' on' : ''}`} onClick={() => setTab(key)}>{label}</button>)}
          </div>
          <div className="rt-scroll">
            {message && <div className="rt-warn" onClick={() => setMessage(null)} style={{ cursor: 'pointer' }} title="Clic para cerrar">{message}</div>}
            {tab === 'regla' && ruleTab}
            {tab === 'resumen' && summaryTab}
            {tab === 'trades' && tradesTab}
            {tab === 'patrones' && patternsTab}
            {tab === 'historial' && historyTab}
            {tab === 'ordenes' && ordersTab}
          </div>
          <div style={{ padding: 8, borderTop: '1px solid var(--t-line, #ddd)', flexShrink: 0 }}>
            <button type="button" className="rt-btn primary" style={{ width: '100%', padding: '6px 0' }} disabled={running || !phaseInfo?.available} onClick={() => runPhase(false)}>
              {running ? `${job.stage}… ${job.done}/${job.total}` : `Correr la regla en la fase ${phase}`}
            </button>
            {running && <div className="rt-progress"><div style={{ width: `${Math.round(100 * job.done / Math.max(1, job.total))}%` }} /></div>}
            {running && <div className="rt-note" style={{ marginTop: 4 }}>La primera corrida de cada marco y fase detecta los elementos de todo el tramo y tarda varios minutos. Las siguientes, segundos.</div>}
          </div>
        </div>

        <div className="rt-chart backtesting-main" onMouseDown={() => setShowList(false)}>
          {status && <div className="rt-overlay">{status}</div>}
          {!status && phaseInfo && !chartOpen && !ordersView && (
            <div className="rt-overlay" style={{ zIndex: 5, background: 'var(--t-page, #fff)', opacity: 1, flexDirection: 'column', gap: 12 }}>
              <div style={{ maxWidth: 460 }}>
                Fase {phase} · {phaseInfo.name}. El gráfico de esta fase no se muestra hasta que lo pidas: primero el informe.
                {result ? ' Verlo no gasta nada por sí solo; cambiar la regla por lo que veas, sí.' : ' Corre la regla para ver su informe.'}
              </div>
              {result && <button type="button" className="rt-btn" onClick={() => setRevealed(previous => ({ ...previous, [phase]: true }))}>Ver el gráfico de la fase {phase}</button>}
            </div>
          )}
          {!status && market?.timeframes?.[chartTf]?.main?.length > 0 && chartTime !== null && (
            <div className="timeframe-panel" style={{ position: 'absolute', inset: 0 }}>
              <MiniChart
                ref={chartRef}
                key={`${symbol}-${chartTf}-${phase}-${chartOpen}-${ordersView}`}
                symbol={symbol}
                interval={chartTf}
                days={days}
                isActive={true}
                indicatorStates={indicatorStates}
                backtestingMode={true}
                backtestingData={market}
                currentTime={chartTime}
                simulationStartTime={phaseInfo.start}
                vpConfig={vpConfig}
                vpFixedRange={vpFixedRange}
                oiMode="histogram"
                rejectionPatternConfig={rejectionConfig}
                currentTool={tool}
                onToolChange={setTool}
                getTradeBoundaries={getTradeBoundaries}
                getTradeBoxes={getTradeBoxes}
                getTradeBands={getTradeBands}
                onRequestPause={noop}
                onRequestTimeChange={noop}
                onDrawingsChange={noop}
                onCandleClick={noop}
                chosenStyle="numbers"
              />
            </div>
          )}
        </div>
      </div>
      {settingsFor && (
        <ChartIndicatorSettings
          name={settingsFor}
          setName={setSettingsFor}
          chartRef={chartRef}
          symbol={symbol}
          timeframe={chartTf}
          candles={market?.timeframes?.[chartTf]?.main || []}
          closedCandles={() => {
            const candles = market?.timeframes?.[chartTf]?.main || [];
            return chartTime === null ? [] : candles.slice(0, lastClosedIndex(candles, chartTf, chartTime) + 1);
          }}
          startTime={phaseInfo?.start}
          label="backtesting global"
          vpConfig={vpConfig}
          setVpConfig={setVpConfig}
          setVpFixedRange={setVpFixedRange}
          rejectionConfig={rejectionConfig}
          setRejectionConfig={setRejectionConfig}
          setIndicatorStates={setIndicatorStates}
        />
      )}
    </div>
  );
};

export default RuleTesterApp;
