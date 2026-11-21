import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MiniChart from '../MiniChart';
import { API_BASE_URL } from '../../config.js';
import { useUiTheme } from '../useUiTheme.js';
import { formatR, registryChartView } from './observer.js';
import { THEME, isNewTheme } from '../uiTheme.js';
import { withoutSubdivisions } from './marketData';
import { cachedMarketData } from './SecondaryChartApp';
import ChartIndicatorSettings, { WITH_SETTINGS } from './ChartIndicatorSettings';
import RuleSearchTab from './RuleSearchTab';
import RegimeTab from './RegimeTab';
import StrategiesTab from './StrategiesTab';
import { lastClosedIndex } from './replayClock';
import { latestFreeBox } from './orderPlan.js';
import { priceText, scaleFromCandles, setBlindAnchor, setBlindScale } from './blindClock.js';
import { ACTION_LABEL, REVIEW_DAYS, boxDecision, gapText, hasBox, reviewBoxes, statText } from './candidateReview.js';
import {
  CHART_TIMEFRAMES, MAX_ELEMENTS, MAX_FILTERS, MAX_WINDOW, VP_PERIODS, VP_SHAPES, CC_STRUCT_TFS, CC_OFFSETS, minuteOfDay, usesPatterns, usesResponse, sequenceParts, usesProfile, RULE_TIMEFRAMES, DAILY_TF, TF_LABEL, defaultRule, deleteRule, describeRule,
  accountStats, fmtPct, fmtR, TESTER_PARAM, fromBackendRule, loadSavedRules, saveRule, sortTrades, testerSymbol, toBackendRule, tradeBands, tradeBoxes,
  contextBands, skippedSignals, signalChecklist, checklistBand, targetInR, TP_TRAIL_UNITS, tpTrailText, usesVpa
} from './ruleTester.js';
import { elementLabel, elementLabels } from './elementLabels.js';
import {
  FACETS, OFF_PATCH, SECTIONS, exitScale, facetPhrase, loadedSummary, ruleDifferences, ruleFacets, sectionCounts, sectionSummary, signalFunnel
} from './ruleFacets.js';
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
  'Volumen de Respuesta', 'Lector VPA', 'Liquidaciones', 'Elementos OF', 'VWAP', 'Rangos horizontales', 'Rejection Patterns', 'Support & Resistance',
  'S&R v2', 'Swing Detector', 'Estructura SMC', 'Alligator', 'Fractales', 'Tres sabios', 'Zonas de Williams', 'AO', 'AC', 'Gator', 'MFI'
];
const DEFAULT_ON = new Set(['Volume Delta', 'Order Flow', 'Elementos OF']);
const VP_CONFIG = { mode: 'dynamic', rowCount: 100, valueAreaPercent: 70, hideWhenFixedRanges: false, showPOC: true, showVAH: true, showVAL: true };
const TIME = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const stamp = (ms) => TIME.format(new Date(ms));
const noop = () => {};
// Herramientas de dibujo del gráfico, las mismas de la barra de dibujo de la simulación manual
const DRAW_TOOLS = [['select', 'Cursor'], ['trendline', 'Línea de tendencia'], ['horizontal', 'Línea horizontal'], ['vertical', 'Línea vertical'],
  ['rectangle', 'Rectángulo'], ['fibonacci', 'Fibonacci'], ['textbox', 'Texto'], ['tpsl', 'Caja TP/SL larga'], ['tpsl-short', 'Caja TP/SL corta']];
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

/** Interruptor de una opción de la regla: encendido toma el color de acento; apagado queda gris */
const Switch = ({ on, onChange, children, title, locked }) => (
  <button type="button" role="switch" aria-checked={!!on} className={`rt-switch${on ? ' on' : ''}${locked ? ' locked' : ''}`}
    onClick={locked ? undefined : () => onChange(!on)} title={title} disabled={locked}>
    <span className="rt-switch-track"><span className="rt-switch-knob" /></span>
    <span>{children}</span>
  </button>
);

/**
 * Una opción de la regla con su interruptor (pedido del usuario, 20/11: había opciones encendidas que no se notaban).
 * Encendida resalta y muestra sus valores debajo; apagada es una sola línea gris, sin números. `id` es su ancla para
 * «Vas a correr» (rt-opt-<id>); `sub` la cuelga de la opción de arriba
 */
const Opt = ({ id, label, on, onToggle, title, sub, children }) => (
  <div id={id ? `rt-opt-${id}` : undefined} className={`rt-opt${on ? ' on' : ''}${sub ? ' sub' : ''}`}>
    <Switch on={on} onChange={onToggle} title={title}>{label}</Switch>
    {on && children && <div className="rt-opt-body">{children}</div>}
  </div>
);

/** Sección plegable de la regla: su encabezado dice cuántas piezas activas tiene y, plegada, cuáles son */
const Section = ({ id, title, badge, hot, summary, open, onToggle, children }) => (
  <div id={`rt-sec-${id}`} className={`rt-sec${open ? ' open' : ''}`}>
    <button type="button" className="rt-sec-head" aria-expanded={!!open} onClick={() => onToggle(id)} title={open ? 'Plegar la sección' : 'Abrir la sección'}>
      <span className="rt-sec-caret">{open ? '▾' : '▸'}</span>
      <span className="rt-sec-title">{title}</span>
      {badge && <span className={`rt-sec-badge${hot ? ' hot' : ''}`}>{badge}</span>}
    </button>
    {!open && summary && <div className="rt-sec-sum" onClick={() => onToggle(id)}>{summary}</div>}
    {open && <div className="rt-sec-body">{children}</div>}
  </div>
);

// La salida en R desde la entrada: el stop en −1 y cada salida en su lugar (stop a la entrada, arranques y objetivo)
const SCALE_COLOR = { stop: '#F23645', entry: '#787B86', even: '#787B86', trail: '#F57C00', drag: '#089981', target: '#089981' };
const ExitScale = ({ marks }) => {
  if (!marks || marks.length <= 2) return null; // Solo el stop y la entrada: nada que ubicar
  const width = 380;
  const low = -1;
  const high = Math.max(2, ...marks.map(m => m.r));
  const x = (r) => 14 + ((r - low) / (high - low)) * (width - 28);
  const rText = (r) => `${r < 0 ? '−' : ''}${Math.abs(r)}R`;
  return (
    <svg className="rt-scale" viewBox={`0 0 ${width} 48`} role="img" aria-label="La salida en R desde la entrada">
      <line x1={x(low)} x2={x(high)} y1="24" y2="24" stroke="currentColor" strokeOpacity="0.25" />
      {marks.map((m, i) => (
        <g key={m.kind}>
          <line x1={x(m.r)} x2={x(m.r)} y1="17" y2="31" stroke={SCALE_COLOR[m.kind]} strokeWidth="2" />
          <text x={x(m.r)} y={i % 2 ? 44 : 11} fontSize="10" fill={SCALE_COLOR[m.kind]}
            textAnchor={i === 0 ? 'start' : i === marks.length - 1 ? 'end' : 'middle'}>{m.kind === 'entry' ? m.label : `${m.label} ${rText(m.r)}`}</text>
        </g>
      ))}
    </svg>
  );
};

/** El embudo de las señales de una corrida: cuántas dio la regla, cuántas quitó cada motivo y cuántos trades quedaron */
const Funnel = ({ steps }) => {
  if (!steps?.length) return null;
  const top = Math.max(1, steps[0].count);
  const num = (value) => Number(value || 0).toLocaleString('es-CO');
  return (
    <div className="rt-funnel">
      {steps.map((step, i) => {
        const edge = i === 0 || step.last;
        return (
          <div key={`${step.label}-${i}`} className={`rt-funnel-row${edge ? ' edge' : ''}`}>
            <span className="rt-funnel-label">{edge ? step.label : `− ${step.label}`}</span>
            <span className="rt-funnel-bar"><span style={{ width: `${(100 * step.left) / top}%` }} /></span>
            <span className="rt-funnel-num">{edge ? num(step.count) : `−${num(step.count)} → ${num(step.left)}`}</span>
          </div>
        );
      })}
    </div>
  );
};

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

const BriefTable = ({ title, rows, first = '', labels = false }) => (!rows?.length ? null : (
  <div className="rt-group">
    <h4>{title}</h4>
    <table className="rt-table">
      <thead><tr><th>{first}</th><th>Trades</th><th>Acierto</th><th>R medio</th><th>R total</th></tr></thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.label}><td>{labels ? elementLabels(row.label) : row.label}</td><td>{row.n}</td><td>{fmtPct(row.winRate)}</td><td><R value={row.avgR} digits={3} /></td><td><R value={row.totalR} /></td></tr>
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
          <tr key={row.label} title={`${row.label} · ${names[row.label] || ''}`}>
            <td>{elementLabel(row.label, names[row.label])}</td>
            <td>{row.with.n} · {fmtPct(row.with.winRate)}</td><td><R value={row.with.avgR} digits={3} /></td>
            <td>{row.without.n} · {fmtPct(row.without.winRate)}</td><td><R value={row.without.avgR} digits={3} /></td>
            <td>{row.with.avgR !== null && row.without.avgR !== null ? <R value={row.with.avgR - row.without.avgR} digits={3} /> : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
));

/** Las dos formas de leer los trades: 1 R por trade, o como una cuenta que arriesga un % del capital en cada uno */
const ModeSwitch = ({ mode, onMode, risk, onRisk }) => (
  <div className="rt-row" style={{ marginBottom: 6 }}>
    <button type="button" className={`rt-btn${mode !== 'account' ? ' on' : ''}`} onClick={() => onMode('trade')} title="Cada trade cuenta 1 R, sin importar cuántos haya abiertos a la vez">Por trade</button>
    <button type="button" className={`rt-btn${mode === 'account' ? ' on' : ''}`} onClick={() => onMode('account')} title="Una sola cuenta: cada trade arriesga un % del capital que hay al entrar">Como cuenta</button>
    {mode === 'account' && (
      <>
        <span title="Parte del capital que se pierde si un trade toca su stop">Riesgo por trade</span>
        <Num value={risk} min={0.05} max={10} step={0.25} onChange={onRisk} /><span>%</span>
      </>
    )}
  </div>
);

const signedPct = (value, digits = 1) => (value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${Number(value).toFixed(digits)}%`);

const AccountView = ({ trades, risk }) => {
  const stats = useMemo(() => accountStats(trades, risk), [trades, risk]);
  if (!stats) return <div className="rt-note">Pon un riesgo por trade mayor que cero para ver la cuenta.</div>;
  return (
    <>
      <div className="rt-cards">
        <div className="rt-card"><b style={{ color: tone(stats.totalReturn) }}>{signedPct(stats.totalReturn)}</b><span>Retorno total ({stats.years} años)</span></div>
        <div className="rt-card"><b style={{ color: tone(stats.annualReturn) }}>{signedPct(stats.annualReturn)}</b><span>Retorno anual</span></div>
        <div className="rt-card"><b>{stats.maxDrawdown}%</b><span>Mayor caída del capital</span></div>
        <div className="rt-card"><b>{stats.sharpe ?? '—'}</b><span>Sharpe anual</span></div>
        <div className="rt-card"><b>{stats.sortino ?? '—'}</b><span>Sortino anual</span></div>
        <div className="rt-card"><b>{stats.positiveMonths} de {stats.months}</b><span>Meses positivos (peor {signedPct(stats.worstMonth)})</span></div>
        <div className="rt-card"><b>{stats.maxOpen}</b><span>Máximo de posiciones a la vez ({stats.maxOpenRisk}% en riesgo)</span></div>
        <div className="rt-card"><b>{signedPct(stats.worstDay, 2)}</b><span>Peor día (mejor {signedPct(stats.bestDay, 2)})</span></div>
        <div className="rt-card"><b>{stats.trades}</b><span>Trades en {stats.days} días</span></div>
      </div>
      <Equity points={stats.equity} />
      <div className="rt-note">
        Una cuenta que arriesga {stats.riskPct}% del capital que tiene al entrar en cada trade, con comisiones. Sharpe y Sortino salen de los retornos diarios (UTC), por 365 días.
        El resultado de un trade entra a la cuenta al cerrarse: lo que se mueve una posición abierta no se ve, así que la caída real dentro del día puede ser mayor.
        No cuenta el financiamiento ni el deslizamiento.
      </div>
    </>
  );
};

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
  // Lo que usó la regla alrededor del trade elegido (líneas, elementos, filtros y señales), y si se dibuja
  const [tradeContext, setTradeContext] = useState(null);
  const [showContext, setShowContext] = useState(() => view.showContext !== false);
  const [regimeBands, setRegimeBands] = useState(null); // Zonas de la pestaña Régimen, para el gráfico
  const [detail, setDetail] = useState(null);
  const [sens, setSens] = useState(null);
  const [statsMode, setStatsMode] = useState(view.statsMode === 'account' ? 'account' : 'trade'); // Por trade (1 R cada uno) o como cuenta
  const [accountRisk, setAccountRisk] = useState(Number(view.accountRisk) > 0 ? Number(view.accountRisk) : 1);
  const [allStarting, setAllStarting] = useState(false); // Entre el clic y la respuesta del backend
  // Grupo de monedas de "Correr en todas": base (las 7 de App 1, con las que se eligen las reglas), new (las nuevas) o all
  const [coinGroup, setCoinGroup] = useState(() => { try { return localStorage.getItem('tester_coin_group') || 'base'; } catch { return 'base'; } });
  const coinGroupRef = useRef(coinGroup);
  useEffect(() => { coinGroupRef.current = coinGroup; try { localStorage.setItem('tester_coin_group', coinGroup); } catch { /* sin almacenamiento */ } }, [coinGroup]);
  const [allReport, setAllReport] = useState(null); // Informe de todas las monedas, de la regla y la fase con que se pidió
  const [message, setMessage] = useState(null);
  const [sort, setSort] = useState({ key: 'n', desc: false });
  const [shown, setShown] = useState(PAGE);
  const [chartTf, setChartTf] = useState(CHART_TIMEFRAMES.includes(view.chartTf) ? view.chartTf : '15m');
  const [indicatorStates, setIndicatorStates] = useState(() => Object.fromEntries(INDICATORS.map(name => [name, view.indicators?.[name] ?? DEFAULT_ON.has(name)])));
  const [showList, setShowList] = useState(false);
  const [showDraw, setShowDraw] = useState(false);   // Menú de herramientas de dibujo
  const drawingsRef = useRef([]);                    // Dibujos del gráfico: se vuelven a poner al cambiar de marco
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
  const [review, setReview] = useState(null);       // Sesión de revisión de candidatos a la vista
  const [reviewReport, setReviewReport] = useState(null);
  const [reviewDays, setReviewDays] = useState(REVIEW_DAYS);
  const [reviewAny, setReviewAny] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewPick, setReviewPick] = useState(null);     // Decisión cuya caja se muestra; sin elegir, la del último trade
  const [reviewWait, setReviewWait] = useState(Number(view.reviewWait) > 0 ? Number(view.reviewWait) : 48);       // Velas que espera la limit de la caja
  const [reviewLimit, setReviewLimit] = useState(true);   // La caja entra como limit en su precio de entrada
  const [reviewFollow, setReviewFollow] = useState(true); // Tras entrar, seguir hasta que el trade cierre
  const [reviewShapes, setReviewShapes] = useState([]); // Dibujos del gráfico, para leer la caja TP/SL de una decisión
  const usedBoxesRef = useRef(new Set());
  const shownAtRef = useRef(null);
  const blindRef = useRef(null);
  const [blindShown, setBlindShown] = useState(null); // Sesión cuyo índice de precios ya está puesto
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
  // La regla del formulario en palabras, por sección (pedido del usuario, 20/11): el resumen de cada sección plegada,
  // «Vas a correr» sobre el botón de correr y lo que cambió contra la corrida a la vista
  const measureLabels = useMemo(() => Object.fromEntries((info?.measures || []).map(m => [m.key, m.label])), [info]);
  const backendRule = useMemo(() => {
    try {
      return toBackendRule(rule);
    } catch {
      return null; // Un campo a medio escribir: el resumen espera al siguiente cambio
    }
  }, [rule]);
  const planFacets = useMemo(() => ruleFacets(backendRule, { measures: measureLabels }), [backendRule, measureLabels]);
  const counts = useMemo(() => sectionCounts(planFacets), [planFacets]);
  const summaries = useMemo(() => Object.fromEntries(SECTIONS.map(([id]) => [id, sectionSummary(planFacets, id)])), [planFacets]);
  const runDiffs = useMemo(() => (result?.rule && backendRule ? ruleDifferences(backendRule, result.rule, { measures: measureLabels }) : []),
    [backendRule, result, measureLabels]);
  const [openSections, setOpenSections] = useState(() => ({ elementos: true, filtros: true, entrada: true, stop: true, salida: true, deteccion: false, ...(view.sections || {}) }));
  const toggleSection = (id) => setOpenSections(previous => ({ ...previous, [id]: !previous[id] }));
  const [loaded, setLoaded] = useState(null); // Lo que trajo la última regla cargada, para revisarlo antes de correrla
  const [planOpen, setPlanOpen] = useState(() => view.planOpen !== false); // «Vas a correr» abierto o en una línea
  // Sin almacén de trades, o con la regla en 1 día, corre sobre velas: solo valen los elementos de candleCodes
  const candleOnly = !!info && (!!info.storeless || rule.tf === DAILY_TF);

  const refreshInfo = useCallback(() => api(`/api/tester/info/${symbol}`).then(setInfo).catch(error => setMessage(error.message)), [symbol]);

  useEffect(() => {
    document.title = `App 1 · Backtesting global · ${symbol}`;
    refreshInfo();
  }, [symbol, refreshInfo]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ rule, chartTf, indicators: indicatorStates, vpConfig, statsMode, accountRisk, reviewWait, showContext, sections: openSections, planOpen }));
    } catch {
      // Sin almacenamiento la vista dura hasta cerrar la ventana
    }
  }, [rule, chartTf, indicatorStates, vpConfig, statsMode, accountRisk, reviewWait, showContext, openSections, planOpen]);

  // Monedas nuevas y acciones no tienen caché de App 1: sus velas salen del probador (del disco). Pedirlas a
  // /api/backtesting/bulk-data las bajaría de Bybit y las guardaría en ese caché, que está en git y decide cuáles
  // son las monedas de siempre (y Bybit no tiene acciones). null mientras no se sabe el grupo del símbolo
  const external = info?.baseSymbols ? !info.baseSymbols.includes(symbol) : null;

  // Velas: del caché del navegador que guardó la principal. Si no están, se pide al backend solo el marco
  // del gráfico: esta ventana no necesita los cinco marcos
  useEffect(() => {
    let active = true;
    const has = (data) => data?.timeframes?.[chartTf]?.main?.length > 0;
    if (external === null) return undefined;
    (async () => {
      let data = marketRef.current;
      // Los avisos solo si este pedido sigue siendo el del marco a la vista: uno de un marco que se dejó, al terminar,
      // ya no los quita, y su "Completando…" tapaba el gráfico del marco nuevo
      if (external) {
        if (has(data)) return;
        if (active) setStatus(`Cargando las velas de ${chartTf} de ${symbol}…`);
        try {
          const found = await api(`/api/tester/chart-candles/${symbol}?tf=${TF_MINUTES[chartTf]}`);
          if (!found.success) throw new Error(found.message || 'sin velas');
          const main = found.t.map((t, i) => ({ timestamp: t, open: found.o[i], high: found.h[i], low: found.l[i], close: found.c[i], volume: found.v[i] }));
          data = { ...(marketRef.current || {}), symbol, timeframes: { ...(marketRef.current?.timeframes || {}), [chartTf]: { main, extended: true } } };
        } catch (error) {
          if (active) setStatus(`No hay velas de ${chartTf} para ${symbol}. Las monedas nuevas tienen 1H y 4H; las acciones, 15M, 1H y 4H.`);
          return;
        }
        marketRef.current = data;
        if (!active) return;
        setMarket(data);
        setStatus(null);
        return;
      }
      if (has(data) && (TF_MINUTES[chartTf] < 5 || data.timeframes[chartTf].extended)) return;
      if (active) setStatus(`Cargando las velas de ${symbol}…`);
      if (!data) data = await cachedMarketData(symbol);
      if (!has(data)) {
        try {
          if (active) setStatus(`Pidiendo las velas de ${chartTf} de ${symbol} al backend…`);
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
          if (active) setStatus(`Completando las velas de ${chartTf} anteriores al ${new Date(main[0].timestamp).toISOString().slice(0, 10)} (la primera vez tarda)…`);
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
  }, [symbol, chartTf, external]);

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

  // Una moneda abierta desde "Todas" llega con su corrida en la dirección (&run=): se abre con sus trades. Solo una corrida
  // de esta misma moneda, y el parámetro sale de la dirección para que recargar no la vuelva a abrir
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const runId = params.get('run');
    if (!runId) return;
    params.delete('run');
    window.history.replaceState(null, '', `?${params.toString()}`);
    if (!/^[A-Za-z0-9.-]+_\d+_f\d_[0-9a-f]+_\d+$/.test(runId) || !runId.startsWith(`${symbol}_`)) return;
    loadRun(runId).catch(error => setMessage(error.message));
  }, [loadRun, symbol]);

  // El informe de todas las monedas que ya corrieron esa regla exacta en esa fase
  const loadAll = useCallback(async (backendRule, phaseNumber) => {
    const report = await api('/api/tester/consolidated', { rule: backendRule, phase: phaseNumber, group: coinGroupRef.current });
    if (!report.success) {
      setMessage(report.message || 'No se pudo armar el informe de todas las monedas');
      return;
    }
    setAllReport(report);
    setTab('todas');
  }, []);
  const allRuleRef = useRef(null);

  useEffect(() => {
    if (!job?.id || job.state !== 'running') return undefined;
    const timer = setInterval(async () => {
      try {
        const { job: current } = await api(`/api/tester/job/${job.id}`);
        if (!current) return;
        setJob(current);
        if (current.state === 'done' && current.all) {
          await loadAll(allRuleRef.current, current.phase);
          refreshInfo();
        } else if (current.state === 'done') {
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
  }, [job?.id, job?.state, loadRun, loadAll, refreshInfo]);

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

  const runAll = async (confirm = false) => {
    setMessage(null);
    if (!rule.codes.length) {
      setMessage('Elige al menos un elemento.');
      return;
    }
    setAllStarting(true);
    try {
      const backendRule = toBackendRule(rule);
      const response = await api('/api/tester/run-all', { rule: backendRule, phase, confirm, group: coinGroup });
      if (!response.success) {
        setMessage(response.message);
        return;
      }
      const names = (action) => response.plan.filter(row => row.action === action).map(row => row.symbol);
      if (response.needsConfirm) {
        const skipped = response.plan.filter(row => row.action === 'skip').map(row => `${row.symbol} (${row.reason})`);
        const text = `Fase ${phase} en todas las monedas.\n\nSe corre una sola vez por moneda y el resultado queda guardado.\n\n`
          + `Se van a correr: ${names('run').join(', ')}.`
          + `${names('stored').length ? `\nYa corridas, se usa lo guardado: ${names('stored').join(', ')}.` : ''}`
          + `${skipped.length ? `\nNo entran: ${skipped.join('; ')}.` : ''}\n\n¿Correrlas?`;
        setAllStarting(false);
        if (window.confirm(text)) await runAll(true);
        return;
      }
      // Si ya corría un trabajo de todas las monedas, se sigue ese, con la regla con que se lanzó
      if (response.already) setMessage('Ya hay una corrida de todas las monedas en curso: se sigue esa.');
      if (!response.already || !allRuleRef.current) allRuleRef.current = backendRule;
      if (response.done) {
        await loadAll(backendRule, phase);
        return;
      }
      setJob({ id: response.job, state: 'running', done: 0, total: 1, stage: names('run')[0] || 'Todas las monedas', all: true, phase });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setAllStarting(false);
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

  // Revisión de candidatos: la sesión abierta de esta moneda, si la hay
  const loadReviewReport = useCallback(() => api('/api/review/report').then(r => r.success && setReviewReport(r)).catch(noop), []);
  useEffect(() => {
    api(`/api/review/active/${symbol}`).then(answer => {
      if (answer.session) {
        setReview(answer);
        setPhase(1);
        setTab('revision');
      }
    }).catch(noop);
  }, [symbol]);
  useEffect(() => { if (tab === 'revision') loadReviewReport(); }, [tab, loadReviewReport]);
  const reviewOn = !!review?.session && !review.session.done && !!review.candidate;

  // Fecha y precio ocultos mientras se decide, como en la simulación manual con fecha oculta
  const reviewBlind = reviewOn ? review.session.id : null;
  const reviewCandles = market?.timeframes?.[chartTf]?.main;
  useEffect(() => {
    if (!reviewBlind || !reviewCandles?.length) return undefined;
    const start = review.session.start;
    if (blindRef.current?.id !== reviewBlind) {
      // El índice sale del id de la sesión: al recargar la página los precios ocultos siguen siendo los mismos
      const seed = [...reviewBlind].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 1000003, 7) / 1000003;
      blindRef.current = { id: reviewBlind, scale: scaleFromCandles(reviewCandles, start, () => seed) };
    }
    setBlindAnchor(start);
    setBlindScale(blindRef.current.scale);
    setBlindShown(reviewBlind); // El panel también escribe precios: se vuelve a pintar ya con el índice
    chartRef.current?.redraw?.();
    return () => {
      setBlindAnchor(null);
      setBlindScale(null);
      setBlindShown(null);
      chartRef.current?.redraw?.();
    };
  }, [reviewBlind, reviewCandles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al llegar un candidato el gráfico vuelve a la última vela conocida y empieza a contar el tiempo de la decisión
  const reviewIndex = reviewOn ? review.candidate.i : null;
  useEffect(() => {
    if (reviewIndex === null) return undefined;
    shownAtRef.current = Date.now();
    const timer = setTimeout(() => chartRef.current?.followLatest?.(), 80);
    return () => clearTimeout(timer);
  }, [reviewIndex, chartTf]);

  const takeReview = (answer) => {
    if (!answer.success) {
      setMessage(answer.message || 'No se pudo');
      return false;
    }
    setReview(answer.session ? answer : null);
    return true;
  };
  const startReview = async () => {
    setMessage(null);
    setReviewBusy(true);
    try {
      const answer = await api('/api/review/start', { symbol, rule: toBackendRule(rule), days: reviewDays, anySymbol: reviewAny });
      if (answer.success && answer.session.symbol !== symbol) {
        window.location.search = `?${TESTER_PARAM}=1&symbol=${answer.session.symbol}`; // La ventana de esa moneda la retoma al abrir
        return;
      }
      if (takeReview(answer)) {
        usedBoxesRef.current = new Set();
        drawingsRef.current = [];
        setReviewShapes([]);
        setPhase(1);
        setOrdersView(false);
        setSelected(null);
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setReviewBusy(false);
    }
  };
  const decideReview = async (action, plan = null) => {
    setReviewBusy(true);
    try {
      const answer = await api('/api/review/decide', { session: review.session.id, i: review.candidate.i, action, stop: plan?.stop ?? null, target: plan?.target ?? null, entry: plan?.limit ?? null, wait: reviewWait, follow: reviewFollow,
        seconds: shownAtRef.current ? (Date.now() - shownAtRef.current) / 1000 : null });
      if (takeReview(answer)) {
        if (plan?.boxId) {
          usedBoxesRef.current.add(plan.boxId);
          const rest = drawingsRef.current.filter(shape => shape.id !== plan.boxId);
          drawingsRef.current = rest;
          setReviewShapes(rest);
          chartRef.current?.loadDrawings?.(rest, true);
        }
        setReviewPick(null);
        setTool('select');
        if (answer.session.done) loadReviewReport();
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setReviewBusy(false);
    }
  };
  const endReview = async () => {
    if (!window.confirm('¿Terminar la sesión aquí? Los candidatos que faltan no se podrán decidir después.')) return;
    try {
      if (takeReview(await api('/api/review/end', { session: review.session.id }))) loadReviewReport();
    } catch (error) {
      setMessage(error.message);
    }
  };
  const closeReview = () => {
    setReview(null);
    loadReviewReport();
  };

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
    if (tab === 'regimen' && regimeBands) {
      // Régimen: solo la referencia y las zonas del detector, sin trades encima
      boxesRef.current = [];
      linesRef.current = [];
      bandsRef.current = regimeBands;
    } else if (review?.session) {
      // En revisión solo se ven las decisiones de la sesión: nada de corridas anteriores, que mostrarían el futuro
      // Una sola caja a la vista: la del trade elegido en la lista o, sin elegir, la del último. Todas juntas tapan el gráfico
      const withTrade = review.decisions.filter(hasBox);
      const shown = withTrade.find(d => d.i === reviewPick) || withTrade[withTrade.length - 1];
      boxesRef.current = reviewBoxes(shown ? [shown] : [], review.candidate?.time ?? null, review.session.tf);
      // La vela del candidato a la vista, marcada: es donde hay que decidir ahora
      bandsRef.current = review.candidate ? [{ kind: 'mark', time: review.candidate.signal, price: review.candidate.entry, label: `Candidato ${review.candidate.i + 1}` }] : [];
      linesRef.current = [];
    } else if (ordersView) {
      boxesRef.current = orderViews.map(item => item.view.box).filter(Boolean);
      bandsRef.current = [];
      linesRef.current = orderViews.filter(item => item.order.id === pickedOrder && item.view.line).map(item => item.view.line);
    } else {
      boxesRef.current = chartOpen && result ? tradeBoxes(trades, result.rule.tf) : [];
      const trade = trades.find(t => t.n === selected);
      linesRef.current = chartOpen && trade ? [{ entryTime: trade.entry_t, exitTime: trade.exit_t, tradeNumber: trade.n }] : [];
      // Lo que la regla vio en el trade elegido: zonas de liquidaciones de ese momento y dónde estaba cada elemento.
      // Debajo, lo que usó alrededor: sus líneas, sus elementos, sus filtros vela a vela y sus señales
      const context = showContext && trade && tradeContext?.runId === result?.id && tradeContext?.n === trade.n ? tradeContext : null;
      const used = context ? contextBands(context, names) : [];
      // Con las líneas enteras, sobra el tramo corto que marca su valor en la señal
      const drawn = new Set(used.filter(b => b.kind === 'line').map(b => b.label));
      const own = chartOpen && trade ? tradeBands(trade, result.rule.tf, names)
        .filter(b => !(b.kind === 'level' && drawn.size && (drawn.has(b.label) || / desv\.$/.test(b.label)))) : [];
      // Encima de todo, la vela de la señal resaltada y el cuadro con cada condición en ese momento
      const check = context ? signalChecklist(context, trade, result.rule.recipe, names) : null;
      const card = check ? checklistBand(check, context, `Señal ${stamp(check.time)} · ${trade.dir > 0 ? 'largo' : 'corto'} · ${check.all ? 'todo se cumplía' : 'no todo se cumplía'}`) : null;
      bandsRef.current = chartOpen && trade ? [...used, ...own, ...(card ? [card] : [])] : [];
    }
    chartRef.current?.redraw?.();
  }, [result, selected, chartOpen, ordersView, orderViews, pickedOrder, review, reviewPick, tab, regimeBands, tradeContext, showContext]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = useCallback((trade) => {
    setSelected(trade.n);
    setDetail(null);
    setOrdersView(false);
    if (phase === 1 || revealed[phase]) focusLater(trade.entry_t, trade.entry);
    api(`/api/tester/result/${result.id}/trade/${trade.n}`).then(d => d.success && setDetail(d)).catch(noop);
    // La primera vez de cada corrida el backend repite la regla (unos segundos); después responde al instante
    const runId = result.id;
    setTradeContext({ runId, n: trade.n, loading: true });
    api(`/api/tester/result/${runId}/trade/${trade.n}/context`)
      .then(d => setTradeContext(current => (current?.runId === runId && current?.n === trade.n ? { ...d, runId, n: trade.n } : current)))
      .catch(error => setTradeContext(current => (current?.runId === runId && current?.n === trade.n ? { success: false, message: error.message, runId, n: trade.n } : current)));
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

  // Dibujos: el gráfico se monta de nuevo al cambiar de marco o de vista, y ahí se le devuelven los que había
  const keepDrawings = useCallback((shapes) => {
    drawingsRef.current = [...(shapes || [])];
    setReviewShapes(drawingsRef.current);
  }, []);
  const chartKey = `${symbol}-${chartTf}-${phase}-${chartOpen}-${ordersView}-${reviewOn ? review.session.id : ''}`;
  useEffect(() => {
    if (!drawingsRef.current.length) return undefined;
    let tries = 0;
    let timer = null;
    const attempt = () => {
      if (chartRef.current?.candleCount?.() > 0) chartRef.current.loadDrawings(drawingsRef.current, true);
      else if (tries++ < 60) timer = setTimeout(attempt, 150);
    };
    timer = setTimeout(attempt, 0);
    return () => clearTimeout(timer);
  }, [chartKey, status]);
  const clearDrawings = () => {
    drawingsRef.current = [];
    setReviewShapes([]);
    chartRef.current?.clearAll?.();
  };

  const getTradeBoxes = useCallback(() => boxesRef.current, []);
  const getTradeBands = useCallback(() => bandsRef.current, []);
  const getTradeBoundaries = useCallback(() => linesRef.current, []);
  // Lo que deja ver el gráfico: la fase 1 completa; la 2 y la 3 solo hasta su inicio mientras no se pida verlas
  const chartTime = reviewOn ? review.candidate.time : review?.session?.done && review.session.until ? review.session.until
    : (ordersView && lastEnd ? lastEnd : (phaseInfo ? (chartOpen ? phaseInfo.end : phaseInfo.start) : null));
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
  // Un interruptor con modo (VWAP, EMA, OI, multitud, régimen, canal) vuelve con el modo que tenía al apagarlo
  const lastModes = useRef({});
  const toggleMode = (field, off, fallback) => (on) => {
    if (on) {
      patch({ [field]: lastModes.current[field] || fallback });
      return;
    }
    if (rule[field] !== off) lastModes.current[field] = rule[field];
    patch({ [field]: off });
  };
  const trailingMode = rule.trail ? 'swing' : rule.trailMode;
  const toggleTrailing = (on) => {
    if (on) {
      const mode = lastModes.current.trailing || 'atr';
      patch({ trail: mode === 'swing', trailMode: mode === 'swing' ? 'off' : mode });
      return;
    }
    if (trailingMode !== 'off') lastModes.current.trailing = trailingMode;
    patch({ trail: false, trailMode: 'off' });
  };
  const toggleMeasures = (on) => {
    if (on) {
      patch({ filters: lastModes.current.filters?.length ? lastModes.current.filters : [{ key: '', op: '>=', value: 0 }] });
      return;
    }
    lastModes.current.filters = rule.filters;
    patch({ filters: [] });
  };
  // La × de una ficha de «Vas a correr»: apaga esa pieza como su interruptor, que la recuerda al volver a encenderla
  const turnOff = (key) => {
    if (key === 'trailing') {
      toggleTrailing(false);
    } else if (key === 'medidas') {
      toggleMeasures(false);
    } else if (OFF_PATCH[key]) {
      Object.entries(OFF_PATCH[key]).forEach(([field, off]) => { if (typeof off === 'string' && rule[field] !== off) lastModes.current[field] = rule[field]; });
      patch(OFF_PATCH[key]);
    }
  };
  // Lleva el panel al control de una pieza y lo resalta un momento; abre su sección si estaba plegada
  const goTo = (key) => {
    const section = FACETS[key]?.[0] || key;
    setTab('regla');
    setOpenSections(previous => (previous[section] ? previous : { ...previous, [section]: true }));
    setTimeout(() => {
      const target = document.getElementById(`rt-opt-${key}`) || document.getElementById(`rt-sec-${section}`);
      if (!target) return;
      target.scrollIntoView({ block: 'center' }); // Sin animación: el resaltado ya dice dónde quedó
      target.classList.remove('rt-flash');
      void target.offsetWidth; // Vuelve a empezar la animación si ya estaba
      target.classList.add('rt-flash');
      setTimeout(() => target.classList.remove('rt-flash'), 1700);
    }, 80);
  };
  // Al cargar una regla, sus filtros, entrada, stop y salidas en palabras: lo que no se ve en las fichas de los elementos
  const showLoaded = (formRule) => {
    let items = [];
    try {
      items = loadedSummary(toBackendRule(formRule), { measures: measureLabels });
    } catch {
      // Sin resumen: la regla se carga igual
    }
    setLoaded({ name: formRule.name, items });
  };
  const loadFormRule = (item) => {
    const next = { ...defaultRule(), ...item };
    setRule(next);
    showLoaded(next);
  };
  const loadBackendRule = (saved) => {
    const next = fromBackendRule(saved);
    setRule(next);
    showLoaded(next);
  };
  const newRule = () => {
    if (!window.confirm('¿Empezar una regla nueva? El formulario vuelve a lo de fábrica, sin elementos ni filtros, con el mismo marco. Lo que no hayas guardado se pierde.')) return;
    setRule({ ...defaultRule(), name: 'Regla nueva', codes: [], first: [], tf: rule.tf });
    setLoaded(null);
  };
  // Lo que va en «Vas a correr»: los elementos en una línea y, en fichas, filtros, entrada, stop y salidas
  const detectionDefault = defaultRule();
  const planRecipe = planFacets.filter(f => ['elementos', 'lado'].includes(f.key)).map(f => f.text).join(' · ');
  // «Una a la vez» y la detección solo salen cuando no son lo de fábrica
  const planChips = planFacets.filter(f => (f.key === 'deteccion'
    ? Number(rule.volFilter) !== detectionDefault.volFilter || Number(rule.target) !== detectionDefault.target
    : ['filtros', 'entrada', 'stop', 'salida'].includes(f.section) && !(f.key === 'unaAlaVez' && rule.oneAtATime)));
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
          <button type="button" className="rt-btn" onClick={newRule} title="Empezar de cero: sin elementos ni filtros, con la entrada, el stop y la salida de fábrica y el mismo marco">Regla nueva</button>
        </div>
        {saved.length > 0 && (
          <div className="rt-row">
            <select value="" onChange={(e) => { const item = saved.find(s => s.name === e.target.value); if (item) loadFormRule(item); }} style={{ flex: 1 }}>
              <option value="">Cargar una regla guardada…</option>
              {saved.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
            {saved.some(s => s.name === rule.name) && <button type="button" className="rt-btn" onClick={() => setSaved(deleteRule(rule.name))}>Borrar</button>}
          </div>
        )}
        {loaded && (
          <div className="rt-loaded">
            <button type="button" className="rt-x" onClick={() => setLoaded(null)} title="Cerrar el aviso" aria-label="Cerrar el aviso">×</button>
            Cargaste «{loaded.name}». {loaded.items.length ? <>Trae: {loaded.items.join(' · ')}.</> : 'No trae filtros ni salidas extra.'} Revísalo en las secciones o en «Vas a correr» antes de correrla.
          </div>
        )}
      </div>

      <div className="rt-group" id="rt-opt-tf">
        <h4>Marco de la regla</h4>
        <div className="rt-row">
          {RULE_TIMEFRAMES.map(tf => <button key={tf} type="button" className={`rt-btn${rule.tf === tf ? ' on' : ''}`} onClick={() => patch({ tf })}>{TF_LABEL[tf]}</button>)}
        </div>
      </div>

      <Section id="elementos" title={`Elementos que disparan (${rule.codes.length} de ${MAX_ELEMENTS})`} summary={summaries.elementos} open={openSections.elementos} onToggle={toggleSection}>
        <div className="rt-chips">
          {(info?.elements || []).map(e => (
            <button key={e.code} type="button" className={`rt-chip${rule.codes.includes(e.code) ? ' on' : ''}`} onClick={() => toggleCode(e.code)}
              disabled={candleOnly && !info.candleCodes.includes(e.code) && !rule.codes.includes(e.code)}
              style={candleOnly && !info.candleCodes.includes(e.code) ? { opacity: 0.4 } : undefined}
              title={`${e.code} · ${e.name}${e.volume ? ' · solo en velas de mucho volumen' : ''}${e.flow ? ' · necesita el almacén de flujo' : ''}${e.code === 'LIQ' ? ' · el precio pasa un swing que coincide con una zona del indicador Liquidaciones' : ''}${e.code === 'VH' ? ' · vela con el doble del volumen normal de su hora, hacia su color' : ''}`}>
              {elementLabel(e.code, e.name)}
            </button>
          ))}
        </div>
        {candleOnly && (
          <div className="rt-note" style={{ marginTop: 4 }}>
            {info.storeless ? `${symbol} no tiene almacén de trades` : 'En 1 día'}: la regla corre sobre las velas guardadas y solo valen {elementLabels(info.candleCodes, ', ')}.
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
                  {elementLabel(code)}
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
        <div className="rt-row" id="rt-opt-lado" style={{ marginTop: 6 }}>
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
              Cambio de carácter: una tendencia de máximos y mínimos crecientes y una vela que cierra bajo su último mínimo abre un corto (al revés, un largo). "Invertir" opera a favor de la tendencia.
              Para el stop detrás del extremo de la tendencia usa "Borde lejano de la zona" y sube el "Máximo" del stop: con la estructura en 4 horas queda a muchos ATR de las velas de la regla.
            </div>
          </>
        )}
        {usesPatterns(rule) && (
          <>
            <div className="rt-row">
              <Check checked={rule.patTrend} onChange={(patTrend) => patch({ patTrend })} title="Un patrón alcista pide que el precio venga bajando, y uno bajista, subiendo">Patrón tras un movimiento en contra de</Check>
              <Num value={rule.patTrendBars} min={1} max={50} disabled={!rule.patTrend} onChange={(patTrendBars) => patch({ patTrendBars })} /><span>velas</span>
            </div>
            <div className="rt-row">
              <Check checked={rule.patVolume} onChange={(patVolume) => patch({ patVolume })} title="Volumen de la vela del patrón contra las 20 anteriores, en desviaciones estándar">Volumen de su vela: z ≥</Check>
              <Num value={rule.patMinZ} min={-3} max={20} step={0.5} disabled={!rule.patVolume} onChange={(patMinZ) => patch({ patMinZ })} />
              <span title="Mecha mínima del martillo y de la estrella fugaz, en veces su cuerpo">· mecha ≥</span>
              <Num value={rule.patWick} min={0.5} max={10} step={0.5} onChange={(patWick) => patch({ patWick })} /><span>cuerpos</span>
            </div>
            <div className="rt-note">Son los patrones del indicador Rejection Patterns, con su misma regla. El lado lo da el patrón: una vela tiene a lo sumo uno. Para el stop detrás de la vela usa "Extremo de la vela del elemento".</div>
          </>
        )}
        {rule.codes.includes('GC') && (
          <>
            <div className="rt-row">
              <span title="Velas del ciclo del filtro gaussiano: más alto, canal más lento">Canal: periodo</span>
              <Num value={rule.gcPeriod} min={10} max={1000} onChange={(gcPeriod) => patch({ gcPeriod })} />
              <span title="Polos del filtro, de 1 a 9: más polos, línea más suave y más atrasada">polos</span>
              <Num value={rule.gcPoles} min={1} max={9} onChange={(gcPoles) => patch({ gcPoles })} />
              <span title="Ancho de las bandas, en rangos verdaderos filtrados">ancho ×</span>
              <Num value={rule.gcMult} min={0.2} max={10} step={0.1} onChange={(gcMult) => patch({ gcMult })} />
            </div>
            <div className="rt-row">
              <Check checked={rule.gcTrend} onChange={(gcTrend) => patch({ gcTrend })} title="Largos solo con la línea central subiendo, y cortos solo con ella bajando">Solo con el canal a favor</Check>
              <span className="rt-note">· su salida por el canal está en «Salida»</span>
            </div>
            <div className="rt-note">
              Entra cuando una vela cierra fuera de la banda (arriba, largo; abajo, corto). La estrategia conocida es solo de largos: pon "Lado: solo alcistas".
              No trae stop: para medir en R usa "Borde lejano de la zona" (queda en la línea central) y sube su "Máximo", o un stop en ATR. Sin "Objetivo" ni "Cierre por tiempo", sale solo por el canal o por el stop.
            </div>
          </>
        )}
        {(rule.codes.includes('IM') || rule.codes.includes('CP')) && (
          <>
            {rule.codes.includes('IM') && (
              <div className="rt-row">
                <span title="El cierre avanza tantos ATR contra el de tantas velas antes; un evento al empezar el impulso">Impulso: al menos</span>
                <Num value={rule.imAtr} min={0.2} max={20} step={0.5} onChange={(imAtr) => patch({ imAtr })} /><span>ATR en</span>
                <Num value={rule.imBars} min={1} max={50} onChange={(imBars) => patch({ imBars })} /><span>velas</span>
                <Check checked={rule.imRangeOn} onChange={(imRangeOn) => patch({ imRangeOn })}>y la vela mide al menos</Check>
                <Num value={rule.imRange} min={0.1} max={20} step={0.5} disabled={!rule.imRangeOn} onChange={(imRange) => patch({ imRange })} /><span>ATR</span>
              </div>
            )}
            {rule.codes.includes('CP') && (
              <div className="rt-row">
                <Check checked={rule.cpMaxHeightOn} onChange={(cpMaxHeightOn) => patch({ cpMaxHeightOn })}>Compresión: solo cajas de hasta</Check>
                <Num value={rule.cpMaxHeight} min={0.5} max={50} step={0.5} disabled={!rule.cpMaxHeightOn} onChange={(cpMaxHeight) => patch({ cpMaxHeight })} /><span>ATR de alto</span>
              </div>
            )}
            <div className="rt-note">
              <b>Impulso</b> entra hacia donde se mueve el precio. <b>Compresión</b> es la vela en que se detecta una caja (las de la pestaña Régimen); no tiene dirección:
              úsala con "Dos órdenes stop" por fuera de la zona, que quedan sobre y bajo la caja.
            </div>
          </>
        )}
        {(rule.codes.includes('FV') || rule.codes.includes('SP')) && (
          <>
            {rule.codes.includes('FV') && (
              <div className="rt-row">
                <span title="Hueco entre el mínimo de la vela y el máximo de dos velas antes (alcista), o al revés (bajista)">FVG: hueco de al menos</span>
                <Num value={rule.fvMinAtr} min={0} max={5} step={0.05} onChange={(fvMinAtr) => patch({ fvMinAtr })} /><span>ATR</span>
              </div>
            )}
            {rule.codes.includes('SP') && (
              <div className="rt-row">
                <span title="El mínimo (alcista) o máximo (bajista) único de tantas velas a cada lado, como el indicador Swing. Se conoce al cerrar la última vela de su derecha">Swing de</span>
                <Num value={rule.spBars} min={2} max={20} onChange={(spBars) => patch({ spBars })} /><span>velas por lado</span>
                <Check checked={rule.spVolume} onChange={(spVolume) => patch({ spVolume })} title="Volumen de la vela del swing en z-score contra las 20 anteriores">con volumen z ≥</Check>
                <Num value={rule.spMinZ} min={-3} max={10} step={0.5} disabled={!rule.spVolume} onChange={(spMinZ) => patch({ spMinZ })} />
              </div>
            )}
            <div className="rt-note">
              <b>FVG nuevo</b> entra con el hueco recién formado; con entrada limit en la zona espera que el precio vuelva al hueco, y el stop "Borde lejano de la zona" queda al otro lado.
              <b> Swing</b> entra cuando el swing se confirma, a favor del giro; el stop "Extremo de la vela del elemento" queda detrás del swing.
              Medido en la fase 1 (4h, siete monedas): FVG nuevo a mercado con hueco de 0.3 ATR o más, stop de 1.5 ATR y 3R, +0.23 R antes de 2023 y +0.31 en 2023 (controles cerca de 0);
              con cualquier hueco, cerca de 0; al revés, pierde. Swing, −0.12 y −0.20, como el azar.
            </div>
          </>
        )}
        {rule.codes.some(code => ['WD', 'WA', 'WF'].includes(code)) && (
          <>
            {rule.codes.includes('WD') && (
              <>
                <div className="rt-row">
                  <span title="La barra divergente alcista hace un mínimo más bajo que tantas velas anteriores y cierra en su mitad de arriba (la bajista, al revés). El libro compara con la anterior">Barra divergente: mínimo más bajo que</span>
                  <Num value={rule.wiseLookback} min={1} max={20} onChange={(wiseLookback) => patch({ wiseLookback })} /><span>velas</span>
                </div>
                <div className="rt-row">
                  <span title="El hueco entre la mandíbula del Alligator y la vela tiene que haber crecido en esas velas: el precio se aleja más rápido que la mandíbula">angulación en</span>
                  <Num value={rule.wiseAngBars} min={1} max={50} onChange={(wiseAngBars) => patch({ wiseAngBars })} /><span>velas, hueco ≥</span>
                  <Num value={rule.wiseMinGapAtr} min={0} max={10} step={0.1} onChange={(wiseMinGapAtr) => patch({ wiseMinGapAtr })} /><span>ATR</span>
                  <Check checked={rule.wiseRequireAo} onChange={(wiseRequireAo) => patch({ wiseRequireAo })} title="El AO rojo en la barra alcista y verde en la bajista: es una entrada contra la tendencia">AO en contra</Check>
                </div>
              </>
            )}
            {rule.codes.includes('WF') && (
              <div className="rt-row">
                <Check checked={rule.wiseTeeth} onChange={(wiseTeeth) => patch({ wiseTeeth })} title="El libro no toma un fractal que el precio pasa del lado equivocado de los dientes del Alligator (la línea roja)">Fractal solo del lado correcto de los dientes</Check>
              </div>
            )}
            <div className="rt-note">
              Los tres sabios de Bill Williams (Trading Chaos), con las medias del libro. <b>Barra divergente</b> y <b>AO tres barras</b> van con la entrada
              "Orden stop" en la vela de la señal y el stop "Extremo de la vela del elemento", como el libro. <b>Ruptura de fractal</b>: la orden stop espera en el
              fractal hasta que el precio lo pasa o llega otro; su stop, el swing anterior. La salida del libro: bajo el mínimo de las últimas 3 a 5 velas.
            </div>
          </>
        )}
        {usesVpa(rule) && (
          <>
            <div className="rt-row">
              <span title="Cada lectura del lector es un grado de 0 a 100%: un elemento cuenta desde este grado">Lector VPA: cuenta desde</span>
              <Num value={Math.round(rule.vpaFire * 100)} min={10} max={100} onChange={(v) => patch({ vpaFire: (Number(v) || 50) / 100 })} /><span>% · tramo de</span>
              <Num value={rule.vpaLeg} min={0.5} max={10} step={0.5} onChange={(vpaLeg) => patch({ vpaLeg })} /><span>ATR</span>
            </div>
            {rule.codes.includes('QE') && (
              <div className="rt-row">
                <span title="El medidor suma la evidencia de cada vela y la deja desvanecerse: la memoria es lo que queda en la vela siguiente">Medidor: umbral ±</span>
                <Num value={rule.vpaMeter} min={0.2} max={5} step={0.1} onChange={(vpaMeter) => patch({ vpaMeter })} /><span>memoria</span>
                <Num value={rule.vpaDecay} min={0} max={0.98} step={0.05} onChange={(vpaDecay) => patch({ vpaDecay })} />
              </div>
            )}
            {rule.codes.some(code => ['QB', 'QF', 'QR'].includes(code)) && (
              <div className="rt-row">
                <span title="La ruptura es el primer cierre fuera del máximo o el mínimo de estas velas; un rango más alto no cuenta como congestión">Ruptura del rango de</span>
                <Num value={rule.vpaRangeBars} min={5} max={200} onChange={(vpaRangeBars) => patch({ vpaRangeBars })} /><span>velas de hasta</span>
                <Num value={rule.vpaMaxRangeAtr} min={1} max={50} step={0.5} onChange={(vpaMaxRangeAtr) => patch({ vpaMaxRangeAtr })} /><span>ATR</span>
                {rule.codes.includes('QR') && <><span>· retroceso en</span><Num value={rule.vpaPullBars} min={1} max={50} onChange={(vpaPullBars) => patch({ vpaPullBars })} /><span>velas</span></>}
              </div>
            )}
            <div className="rt-note">
              El Lector VPA (Coulling) con reglas propias: el volumen y el rango de cada vela contra lo normal de su hora. <b>Esfuerzo sin resultado</b> va contra
              el color de la vela; <b>ruptura con volumen</b> sigue la ruptura y <b>sin volumen</b> va en contra (trampa); <b>retroceso sin volumen</b> entra al volver
              al nivel roto; <b>prueba de poco volumen</b>, <b>frenado o techo</b> y <b>clímax</b> van contra el tramo. Con el stop "Borde lejano de la zona", el stop
              queda detrás del elemento (detrás del nivel roto en las rupturas).
            </div>
          </>
        )}
        {rule.codes.some(code => ['BS', 'OB', 'BK', 'EQ'].includes(code)) && (
          <>
            <div className="rt-row">
              <span title="Pivotes de tramo: una vela es el extremo de su tramo cuando las velas siguientes no la pasan; se sabe esas velas después">Estructura</span>
              <select value={rule.smcScope} onChange={(e) => patch({ smcScope: e.target.value })}>
                <option value="swing">mayor</option>
                <option value="internal">interna</option>
              </select>
              <span>de</span>
              {rule.smcScope === 'internal'
                ? <Num value={rule.smcInternal} min={2} max={50} onChange={(smcInternal) => patch({ smcInternal })} />
                : <Num value={rule.smcSwing} min={5} max={300} onChange={(smcSwing) => patch({ smcSwing })} />}
              <span>velas</span>
            </div>
            {rule.codes.includes('BS') && (
              <div className="rt-row">
                <span>Ruptura:</span>
                <select value={rule.smcBreak} onChange={(e) => patch({ smcBreak: e.target.value })}>
                  <option value="any">BOS o CHoCH</option>
                  <option value="bos">solo BOS (sigue la tendencia)</option>
                  <option value="choch">solo CHoCH (la da vuelta)</option>
                </select>
              </div>
            )}
            {(rule.codes.includes('OB') || rule.codes.includes('BK')) && (
              <div className="rt-row">
                <span>OB:</span>
                <select value={rule.smcPick} onChange={(e) => patch({ smcPick: e.target.value })}>
                  <option value="extreme">la vela del extremo</option>
                  <option value="opposite">la última vela contraria</option>
                </select>
                <select value={rule.smcArea} onChange={(e) => patch({ smcArea: e.target.value })}>
                  <option value="full">entera</option>
                  <option value="body">su cuerpo</option>
                </select>
                <span>lo rompe</span>
                <select value={rule.smcMitigation} onChange={(e) => patch({ smcMitigation: e.target.value })}>
                  <option value="close">un cierre</option>
                  <option value="wick">una mecha</option>
                </select>
              </div>
            )}
            {rule.codes.includes('EQ') && (
              <div className="rt-row">
                <span title="Dos pivotes cortos seguidos del mismo lado casi al mismo precio: liquidez esperando del otro lado">Iguales de</span>
                <Num value={rule.smcEqLength} min={2} max={20} onChange={(smcEqLength) => patch({ smcEqLength })} /><span>velas a menos de</span>
                <Num value={rule.smcEqThreshold} min={0.01} max={2} step={0.05} onChange={(smcEqThreshold) => patch({ smcEqThreshold })} /><span>ATR</span>
                <Check checked={rule.smcReclaim} onChange={(smcReclaim) => patch({ smcReclaim })} title="La vela que barre el nivel cierra de vuelta del otro lado">con regreso</Check>
              </div>
            )}
            <div className="rt-note">
              Estructura SMC con reglas propias. <b>Ruptura de estructura</b> entra al cierre que pasa el pivote; el stop "Borde lejano de la zona" queda detrás del nivel roto.
              <b> Order block</b> nace con la ruptura: con entrada limit en la zona espera que el precio vuelva a él, y el borde lejano es el stop. <b>Breaker</b>: el OB roto, del lado contrario.
              <b> Barrido de iguales</b> va contra el lado barrido; el borde lejano queda detrás del barrido. El objetivo puede ir en el máximo o mínimo del rango mayor (en "Salida").
            </div>
          </>
        )}
        {(rule.codes.includes('BX') || rule.codes.includes('BE')) && (
          <>
            {rule.codes.includes('BX') && (
              <div className="rt-row">
                <Check checked={rule.bxMaxHeightOn} onChange={(bxMaxHeightOn) => patch({ bxMaxHeightOn })} title="Solo rupturas de cajas estrechas, medidas en ATR de la vela que rompe">Ruptura de cajas de hasta</Check>
                <Num value={rule.bxMaxHeight} min={0.5} max={50} step={0.5} disabled={!rule.bxMaxHeightOn} onChange={(bxMaxHeight) => patch({ bxMaxHeight })} /><span>ATR de alto</span>
              </div>
            )}
            {rule.codes.includes('BE') && (
              <div className="rt-row">
                <span title="Parte de la caja que cuenta como borde">Borde: el</span>
                <Num value={rule.beShare} min={0.05} max={0.5} step={0.05} onChange={(beShare) => patch({ beShare })} /><span>de la caja · cuerpo hasta</span>
                <Num value={rule.beMaxBody} min={0} max={10} step={0.1} onChange={(beMaxBody) => patch({ beMaxBody })} /><span>ATR · cierra a</span>
                <Num value={rule.beRejection} min={0} max={1} step={0.05} onChange={(beRejection) => patch({ beRejection })} /><span>o más del borde en su vela</span>
                <Check checked={rule.bePattern} onChange={(bePattern) => patch({ bePattern })} title="Además la vela es un martillo, envolvente o doji a favor, con tendencia previa (la regla del indicador Rejection Patterns)">con patrón de rechazo</Check>
              </div>
            )}
            <div className="rt-note">
              Las cajas son las de la pestaña Régimen (eficiencia con caja). <b>Ruptura de caja</b> entra en la vela que cierra fuera de una caja, a favor de la ruptura.
              <b> Borde de caja</b> entra hacia el centro cuando una vela llega al borde de una caja vigente; con "cuerpo hasta" en 0 y "cierra a" en 0 no filtra la vela.
              Para el borde de caja, el stop "Borde lejano de la zona" queda detrás del borde (con su margen) y el objetivo puede ir al centro de la caja.
              Medido en la fase 1 (4h, siete monedas): ruptura de caja a favor de la EMA 200 con stop de 1.5 ATR y 3R, +0.19 R antes de 2023 y +0.13 en 2023;
              con cajas de hasta 5.5 ATR, +0.24 y +0.21 (los controles, +0.02). Borde de caja con stop a 0.5 ATR tras el borde y objetivo al centro, +0.04 y −0.02; sin filtros de vela, −0.07 y −0.15.
            </div>
          </>
        )}
        {usesResponse(rule) && (
          <>
            <div className="rt-row">
              <span title="El tramo gira cuando un cierre se aleja tantos ATR de su extremo: la misma regla del indicador Volumen de Respuesta">Tramo: gira a</span>
              <Num value={rule.rvLeg} min={0.5} max={10} step={0.5} onChange={(rvLeg) => patch({ rvLeg })} /><span>ATR</span>
            </div>
            {rule.codes.includes('RF') && (
              <div className="rt-row">
                <span title="Volumen de la vela contra la mediana de su misma hora en los 30 días anteriores">Flecha: volumen ≥</span>
                <Num value={rule.rvSpike} min={1.2} max={20} step={0.5} onChange={(rvSpike) => patch({ rvSpike })} /><span>veces su hora ·</span>
                <select value={rule.rvArrow} onChange={(e) => patch({ rvArrow: e.target.value })}>
                  <option value="with">vela a favor del tramo</option>
                  <option value="against">vela contra el tramo</option>
                  <option value="any">cualquier vela</option>
                </select>
              </div>
            )}
            {rule.codes.includes('RB') && (
              <div className="rt-row">
                <span title="El rombo sale cuando la respuesta iguala a la tendencia después de que esta dominó">Rombo: se opera</span>
                <select value={rule.rvRombo} onChange={(e) => patch({ rvRombo: e.target.value })}>
                  <option value="turn">contra el tramo (giro)</option>
                  <option value="follow">a favor del tramo (sigue)</option>
                </select>
              </div>
            )}
            <div className="rt-note">Son las marcas del indicador Volumen de Respuesta, con su regla de fábrica. La flecha se opera hacia el color de su vela. En el estudio del 18/11 se usó stop de 2 ATR y objetivo 2R en 4 horas.</div>
          </>
        )}
        {usesProfile(rule) && (
          <>
            <div className="rt-row">
              <span title="La sesión cuyo perfil se usa: siempre la anterior ya cerrada. Las sesiones van en UTC">Perfil de</span>
              <select value={rule.vpHours} onChange={(e) => patch({ vpHours: Number(e.target.value) })}>
                {VP_PERIODS.map(([hours, label]) => <option key={hours} value={hours}>{label}</option>)}
              </select>
              <span title="Regreso al valor: minutos seguidos cerrando dentro del valor. Aceptación fuera: minutos seguidos cerrando fuera">· sostenido</span>
              <Num value={rule.vpAccept} min={5} max={480} step={5} onChange={(vpAccept) => patch({ vpAccept })} /><span>min</span>
              <span title="Fallo fuera del valor: velas que tiene el precio para cerrar de vuelta dentro del valor después de salir">· fallo en</span>
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
                <span title="Borde del valor: la sesión abre dentro del valor anterior y el precio llega a un borde. Compra en el VAL, vende en el VAH">Borde del valor entra:</span>
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
              Todo se mide contra el POC, el VAH y el VAL de la sesión anterior, con volumen real. Regreso al valor: abre fuera del valor y vuelve a sostenerse dentro (va al borde contrario).
              Fallo fuera del valor: sale del valor y cierra de vuelta dentro (va al POC). Aceptación fuera del valor: se sostiene fuera (sigue la salida). Borde del valor: abre dentro y llega a un borde (compra en el VAL, vende en el VAH; pensado para perfiles D). Para el stop detrás del extremo usa "Borde lejano de la zona".
            </div>
          </>
        )}
        {rule.codes.includes('VA') && (
          <div className="rt-row">
            <span title="La regla del libro cuenta cualquier vela que no toque el área de valor de la anterior, aunque quede a un tick. Con un hueco mínimo solo cuentan las que se alejan de verdad. 0 = regla literal">Área de valor abandonada: hueco mínimo</span>
            <Num value={rule.vaGap} min={0} max={5} step={0.05} onChange={(vaGap) => patch({ vaGap })} /><span>ATR</span>
          </div>
        )}
      </Section>

      <Section id="filtros" title="Filtros" badge={counts.filtros ? `${counts.filtros} ${counts.filtros === 1 ? 'activo' : 'activos'}` : 'ninguno'} hot={counts.filtros > 0}
        summary={summaries.filtros} open={openSections.filtros} onToggle={toggleSection}>
        <div className="rt-note" style={{ marginBottom: 4 }}>Todos se miran al cierre de la vela de la señal, a favor del trade. Lo encendido resalta y entra a la regla; lo apagado no cuenta.</div>
        <div className="rt-sub">Tendencia</div>
        <Opt id="vwap" label="VWAP móvil" on={rule.vwapMode !== 'off'} onToggle={toggleMode('vwapMode', 'off', 'side')} title="Filtro sobre la vela que da a conocer la señal, a favor del trade. Vale para cualquier regla">
          <div className="rt-row">
            <span>de</span><Num value={rule.vwapPeriod} min={2} max={1000} onChange={(vwapPeriod) => patch({ vwapPeriod })} /><span>velas:</span>
            <select value={rule.vwapMode} onChange={(e) => patch({ vwapMode: e.target.value })}>
              <option value="side">el precio cierra a favor</option>
              <option value="touch">la mecha la toca y cierra a favor</option>
            </select>
          </div>
          <div className="rt-row">
            <Check checked={rule.vwapSlope} onChange={(vwapSlope) => patch({ vwapSlope })} title="La línea sube para un largo o baja para un corto, en las últimas 5 velas">pendiente a favor</Check>
            <Check checked={rule.vwapMaxDevOn} onChange={(vwapMaxDevOn) => patch({ vwapMaxDevOn })} title="No opera si la vela de la señal abrió más allá de esa banda del VWAP, del lado del trade: sobre la banda de arriba en un largo, bajo la de abajo en un corto. La desviación es la de las bandas del indicador VWAP móvil, con las mismas velas">la vela abre a no más de</Check>
            {rule.vwapMaxDevOn && <><Num value={rule.vwapMaxDev} min={0.1} max={10} step={0.1} onChange={(vwapMaxDev) => patch({ vwapMaxDev })} /><span>desviaciones</span></>}
          </div>
        </Opt>
        <Opt id="ema" label="EMA" on={rule.emaMode !== 'off'} onToggle={toggleMode('emaMode', 'off', 'side')} title="Filtro sobre la vela que da a conocer la señal, a favor del trade. Vale para cualquier regla">
          <div className="rt-row">
            <span>de</span><Num value={rule.emaPeriod} min={2} max={1000} onChange={(emaPeriod) => patch({ emaPeriod })} /><span>velas:</span>
            <select value={rule.emaMode} onChange={(e) => patch({ emaMode: e.target.value })}>
              <option value="side">el precio cierra a favor</option>
              <option value="touch">la mecha la toca y cierra a favor</option>
            </select>
            <Check checked={rule.emaSlope} onChange={(emaSlope) => patch({ emaSlope })} title="La línea sube para un largo o baja para un corto, en las últimas 5 velas">pendiente a favor</Check>
          </div>
        </Opt>
        <Opt id="regimen" label="Régimen: rango o fuera de él" on={rule.regimeMode !== 'any'} onToggle={toggleMode('regimeMode', 'any', 'outside')} title="Régimen de la vela de la señal, con el detector de la pestaña Régimen (eficiencia con caja afinada), sin futuro. Las entradas al azar de los controles quedan en el mismo régimen">
          <div className="rt-row">
            <select value={rule.regimeMode} onChange={(e) => patch({ regimeMode: e.target.value })}>
              <option value="inside">solo dentro de un rango</option>
              <option value="outside">solo fuera de los rangos</option>
              <option value="breakout">solo tras romper un rango</option>
            </select>
            {rule.regimeMode === 'breakout' && <><Num value={rule.regimeAfter} min={1} max={200} onChange={(regimeAfter) => patch({ regimeAfter })} /><span>velas</span></>}
          </div>
          <div className="rt-row">
            <Check checked={rule.regimeMajor} onChange={(regimeMajor) => patch({ regimeMajor })} title="Sin marcar, valen las cajas chicas del detector">con el rango mayor</Check>
            {rule.regimeMajor && <><span>que termina tras</span><Num value={rule.regimeMajorOut} min={1} max={50} onChange={(regimeMajorOut) => patch({ regimeMajorOut })} /><span>cierres fuera</span></>}
            {rule.tf < DAILY_TF && <Check checked={rule.regimeDaily} onChange={(regimeDaily) => patch({ regimeDaily })} title="El régimen se mide en velas diarias (las de la regla unidas por día UTC) y cada vela de la regla usa el del último día cerrado. Medido en 4h, separa peor que en el marco de la regla">medido en 1D</Check>}
          </div>
        </Opt>
        <div className="rt-sub">Flujo</div>
        <Opt id="cvd" label="CVD a favor" on={rule.cvdOn} onToggle={(cvdOn) => patch({ cvdOn })} title="La delta de las últimas velas, con la de la señal, sobre su volumen va a favor del trade. Con almacén de trades es la delta real; sin él, o en 1D, se estima por dónde cerró cada vela. Los controles al azar entran solo donde el filtro deja entrar">
          <div className="rt-row"><span>de las últimas</span><Num value={rule.cvdBars} min={2} max={500} onChange={(cvdBars) => patch({ cvdBars })} /><span>velas</span></div>
        </Opt>
        <Opt id="oi" label="Interés abierto (OI)" on={rule.oiMode !== 'off'} onToggle={toggleMode('oiMode', 'off', 'rise')} title="Open Interest conocido al cierre de la vela de la señal. BTC tiene OI de 5 minutos; las demás monedas, de 4 horas: en ellas el filtro solo vale en 4h y 1D. Una vela sin OI no pasa">
          <div className="rt-row">
            <select value={rule.oiMode} onChange={(e) => patch({ oiMode: e.target.value })}>
              <option value="rise">sube</option>
              <option value="fall">baja</option>
              <option value="conf">confluencia OI-volumen a favor</option>
              <option value="noconf">sin confluencia OI-volumen en contra</option>
            </select>
            {['rise', 'fall'].includes(rule.oiMode) && <><span>más de</span><Num value={rule.oiPct} min={0} max={50} step={0.5} onChange={(oiPct) => patch({ oiPct })} /><span>% en</span>
              <Num value={rule.oiBars} min={1} max={100} onChange={(oiBars) => patch({ oiBars })} /><span>velas</span></>}
          </div>
        </Opt>
        <Opt id="multitud" label="Multitud (funding)" on={rule.crowdMode !== 'off'} onToggle={toggleMode('crowdMode', 'off', 'nocon')} title="Funding de los 3 días anteriores de la moneda. Contra la multitud: vender cuando los cargados son los largos (funding sobre 0.01% por 8 h) o comprar cuando son los cortos (funding negativo). Medido en 8 reglas y 50 monedas: ir con la multitud suele ser lo peor (unos 0.10 R por trade menos que ir contra ella)">
          <div className="rt-row">
            <select value={rule.crowdMode} onChange={(e) => patch({ crowdMode: e.target.value })}>
              <option value="nocon">no ir con la multitud</option>
              <option value="contra">solo contra la multitud</option>
            </select>
          </div>
        </Opt>
        <Opt id="oiSostenido" label="OI sostenido" on={rule.steadyOn} onToggle={(steadyOn) => patch({ steadyOn })} title="El interés abierto viene subiendo de forma pareja: en los últimos días, la parte de los pasos de 4 horas en que subió el OI llega a ese mínimo. Medido en 8 reglas: +0.05 R por trade en la mediana, también en la fase 3">
          <div className="rt-row">
            <span>sube en</span><Num value={Math.round(rule.steadyMin * 100)} min={30} max={90} onChange={(v) => patch({ steadyMin: (Number(v) || 52) / 100 })} /><span>% o más de los pasos de</span>
            <Num value={rule.steadyDays} min={3} max={60} onChange={(steadyDays) => patch({ steadyDays })} /><span>días</span>
          </div>
        </Opt>
        <div className="rt-sub">Williams y SMC</div>
        <Opt id="alligator" label="Alligator de Williams" on={rule.bwAlligator !== 'off'} onToggle={toggleMode('bwAlligator', 'off', 'awake')} title="El Alligator (13/8, 8/5 y 5/3 del precio medio) en la vela de la señal. Vale para cualquier regla">
          <div className="rt-row">
            <select value={rule.bwAlligator} onChange={(e) => patch({ bwAlligator: e.target.value })}>
              <option value="awake">despierto a favor (labios, dientes y mandíbula en orden y abiertos)</option>
              <option value="side">el cierre del lado de los dientes</option>
              <option value="sleeping">dormido (para operar rangos)</option>
            </select>
          </div>
        </Opt>
        <Opt id="zonaWilliams" label="Zona de Williams a favor" on={rule.bwZone} onToggle={(bwZone) => patch({ bwZone })} title="El AO y el AC suben (verde) para un largo, o bajan los dos (roja) para un corto" />
        <Opt id="ao" label="AO de Williams" on={rule.bwAo !== 'off'} onToggle={toggleMode('bwAo', 'off', 'color')} title="El Awesome Oscillator (media de 5 menos media de 34 del precio medio) en la vela de la señal, a favor del trade. Vale para cualquier regla. La señal del AO de tres barras es el elemento «AO tres barras»">
          <div className="rt-row">
            <select value={rule.bwAo} onChange={(e) => patch({ bwAo: e.target.value })}>
              <option value="color">su barra a favor (verde en un largo, roja en un corto)</option>
              <option value="zero">del lado del cero a favor (sobre el cero en un largo)</option>
              <option value="both">las dos: barra a favor y del lado del cero</option>
            </select>
          </div>
        </Opt>
        <Opt id="ac" label="AC de Williams" on={rule.bwAc !== 'off'} onToggle={toggleMode('bwAc', 'off', 'color')} title="El Accelerator Oscillator (el AO menos su media de 5) en la vela de la señal, a favor del trade. Vale para cualquier regla">
          <div className="rt-row">
            <select value={rule.bwAc} onChange={(e) => patch({ bwAc: e.target.value })}>
              <option value="color">su barra a favor (verde en un largo, roja en un corto)</option>
              <option value="zero">del lado del cero a favor (sobre el cero en un largo)</option>
              <option value="both">las dos: barra a favor y del lado del cero</option>
            </select>
          </div>
        </Opt>
        <Opt id="gator" label="Gator de Williams" on={rule.bwGator !== 'off'} onToggle={toggleMode('bwGator', 'off', 'eating')} title="Las dos barras del Gator en la vela de la señal: arriba la distancia entre la mandíbula y los dientes, abajo entre los dientes y los labios. No mira el lado del trade: va bien junto al Alligator despierto a favor">
          <div className="rt-row">
            <select value={rule.bwGator} onChange={(e) => patch({ bwGator: e.target.value })}>
              <option value="eating">comiendo: sus dos barras crecen (la boca se abre)</option>
              <option value="open">despierto: al menos una barra crece</option>
              <option value="sleeping">dormido: sus dos barras se achican (para operar rangos)</option>
            </select>
          </div>
        </Opt>
        <Opt id="mfi" label="MFI de Williams" on={rule.bwMfi !== 'off'} onToggle={toggleMode('bwMfi', 'off', 'green')} title="El tipo de la vela de la señal por el Market Facilitation Index (rango ÷ volumen) y su volumen, contra la vela anterior. No mira el lado del trade">
          <div className="rt-row">
            <select value={rule.bwMfi} onChange={(e) => patch({ bwMfi: e.target.value })}>
              <option value="green">vela verde: suben el MFI y el volumen</option>
              <option value="squat">vela squat: baja el MFI y sube el volumen</option>
              <option value="volume">verde o squat: sube el volumen</option>
              <option value="notFake">todo menos fake (sube el MFI y baja el volumen)</option>
            </select>
          </div>
        </Opt>
        <div className="rt-sub">Lector VPA</div>
        <Opt id="vpaMedidor" label="Medidor VPA" on={rule.vpaMode !== 'off'} onToggle={toggleMode('vpaMode', 'off', 'favor')} title="El medidor del Lector VPA en la vela de la señal: la evidencia de fuerza (positiva) o debilidad (negativa) que suman las velas, en grados. Vale para cualquier regla">
          <div className="rt-row">
            <select value={rule.vpaMode} onChange={(e) => patch({ vpaMode: e.target.value })}>
              <option value="favor">a favor del trade, desde</option>
              <option value="notAgainst">que no esté en contra más de</option>
            </select>
            <Num value={rule.vpaThr} min={0} max={5} step={0.1} onChange={(vpaThr) => patch({ vpaThr })} />
          </div>
        </Opt>
        <Opt id="premium" label="Premium y discount (SMC)" on={rule.smcPd} onToggle={(smcPd) => patch({ smcPd })} title="Un largo solo bajo la mitad del rango mayor (discount) y un corto solo sobre ella (premium). El rango va entre el último máximo y el último mínimo de la estructura mayor">
          <div className="rt-row"><span>rango de la estructura mayor de</span><Num value={rule.smcSwing} min={5} max={300} onChange={(smcSwing) => patch({ smcSwing })} /><span>velas</span></div>
        </Opt>
        <Opt id="sesgo" label="A favor de la estructura mayor (SMC)" on={rule.smcBias} onToggle={(smcBias) => patch({ smcBias })} title="La tendencia de la última ruptura de la estructura mayor va del lado del trade">
          <div className="rt-row"><span>estructura de</span><Num value={rule.smcSwing} min={5} max={300} onChange={(smcSwing) => patch({ smcSwing })} /><span>velas</span></div>
        </Opt>
        <div className="rt-sub">Forma de la señal</div>
        <Opt id="extremo" label="En un extremo (mínimo o máximo)" on={rule.swing} onToggle={(swing) => patch({ swing })} title="La señal debe darse en un mínimo (alcista) o máximo (bajista) de N velas">
          <div className="rt-row"><span>de</span><Num value={rule.swingBars} min={2} max={20} onChange={(swingBars) => patch({ swingBars })} /><span>velas</span></div>
        </Opt>
        <Opt id="momentum" label="Momentum: EMA 14 a favor" on={rule.momentum} onToggle={(momentum) => patch({ momentum })} title="EMA 14 con pendiente a favor y el precio de su lado" />
        <Opt id="confirmacion" label="Confirmación a favor" on={rule.confirm} onToggle={(confirm) => patch({ confirm })} title="La señal vale cuando el precio avanza a favor">
          <div className="rt-row">
            <Num value={rule.confirmAtr} min={0.05} max={3} step={0.05} onChange={(confirmAtr) => patch({ confirmAtr })} /><span>ATR a favor en</span>
            <Num value={rule.confirmBars} min={1} max={5} onChange={(confirmBars) => patch({ confirmBars })} /><span>velas</span>
          </div>
        </Opt>
        <div className="rt-sub">Horario y medidas</div>
        <Opt id="horario" label="Horario (UTC)" on={rule.useHours} onToggle={(useHours) => patch({ useHours })} title="Solo se operan las señales que se conocen entre esas horas, en UTC. La hora es la del cierre de la vela de la señal, que es cuando se entra">
          <div className="rt-row">
            <span>entre las</span>
            <input type="text" value={rule.hoursFrom} onChange={(e) => patch({ hoursFrom: e.target.value })} style={{ width: 56 }} placeholder="17:30" />
            <span>y las</span>
            <input type="text" value={rule.hoursTo} onChange={(e) => patch({ hoursTo: e.target.value })} style={{ width: 56 }} placeholder="21:30" />
            <Check checked={rule.hoursWeekdays} onChange={(hoursWeekdays) => patch({ hoursWeekdays })}>lunes a viernes</Check>
          </div>
          {(minuteOfDay(rule.hoursFrom) === null || minuteOfDay(rule.hoursTo) === null) && <div className="rt-note">Escribe las horas como 17:30. Mientras no sean válidas, el horario no se aplica.</div>}
          <div className="rt-note">Sesión de Nueva York: de 13:30 a 20:00 UTC en verano y de 14:30 a 21:00 en invierno. Con velas de 4 horas contadas desde las 13:30, las que cierran dentro de la sesión se conocen a las 17:30 y a las 21:30.</div>
        </Opt>
        <Opt id="medidas" label="Medidas del Observador" on={rule.filters.length > 0} onToggle={toggleMeasures} title="Hasta 3 medidas del Observador, leídas a favor del trade al cierre de la vela de la señal">
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
          <div className="rt-note" style={{ marginTop: 4 }}>Una fila sin medida elegida no cuenta.</div>
        </Opt>
      </Section>

      <Section id="entrada" title="Entrada" summary={summaries.entrada} open={openSections.entrada} onToggle={toggleSection}>
        <div className="rt-row">
          <select value={rule.entryType} onChange={(e) => patch({ entryType: e.target.value })}>
            <option value="market">A mercado, en la apertura de la vela siguiente</option>
            <option value="limit">Limit en la zona del elemento</option>
            <option value="straddle">Dos órdenes stop, una arriba y otra abajo: entra la primera que se llena</option>
            <option value="stop">Orden stop a favor, en el borde de la zona (los sabios de Williams)</option>
          </select>
        </div>
        {rule.entryType === 'stop' && (
          <>
            <div className="rt-row">
              <span>más</span><Num value={rule.entryStopOffset} min={0} max={10} step={0.05} onChange={(entryStopOffset) => patch({ entryStopOffset })} /><span>ATR · espera</span>
              <Num value={rule.entryExpiry} min={1} max={500} onChange={(entryExpiry) => patch({ entryExpiry })} /><span>velas</span>
              <Check checked={rule.entryStopCancel} onChange={(entryStopCancel) => patch({ entryStopCancel })} title="Si antes de llenarse el precio pasa el otro borde de la zona (el mínimo de la barra divergente en un largo), la orden se cancela">se cancela si antes pasa el otro borde</Check>
            </div>
            <div className="rt-note">
              Una compra stop en el máximo de la zona del elemento (una venta, en su mínimo): se llena al cruzarlo, o en la apertura si salta por encima.
              Con la barra divergente y las tres barras del AO la zona es la vela de la señal; con el fractal, su nivel, y espera hasta que el precio lo pasa.
              Los controles al azar ponen la orden en velas al azar a la distancia mediana del cierre.
            </div>
          </>
        )}
        {rule.entryType === 'straddle' && (
          <>
            <div className="rt-row">
              <span>a</span><Num value={rule.straddleOffset} min={0} max={10} step={0.1} onChange={(straddleOffset) => patch({ straddleOffset })} /><span>ATR</span>
              <select value={rule.straddleFrom} onChange={(e) => patch({ straddleFrom: e.target.value })}>
                <option value="zone">por fuera de la zona del elemento (arriba y abajo)</option>
                <option value="close">del cierre de la vela de la señal</option>
              </select>
              <span>· vencen en</span><Num value={rule.entryExpiry} min={1} max={200} onChange={(entryExpiry) => patch({ entryExpiry })} /><span>velas</span>
            </div>
            <div className="rt-note">
              La dirección no la da el elemento sino el precio: se llena la orden del lado hacia donde sale, al cruzar su precio (o en la apertura si salta por encima), y la otra se cancela.
              Si las dos se tocan en la misma vela decide el minuto a minuto. Los filtros que miran el lado (VWAP, EMA, CVD, OI) deciden qué orden se pone.
              Pensada para la Compresión: con "por fuera de la zona" quedan sobre la caja y debajo de ella. Los controles al azar ponen las dos órdenes en velas al azar, a la misma distancia.
            </div>
          </>
        )}
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
      </Section>

      <Section id="stop" title="Stop" summary={summaries.stop} open={openSections.stop} onToggle={toggleSection}>
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
      </Section>

      <Section id="salida" title="Salida" badge={`${counts.salida || 0} ${counts.salida === 1 ? 'salida' : 'salidas'} además del stop`} hot={counts.salida > 0}
        summary={summaries.salida} open={openSections.salida} onToggle={toggleSection}>
        <div className="rt-note" style={{ marginBottom: 4 }}>El trade sale por lo primero que ocurra entre lo encendido.</div>
        <div className="rt-opt fixed">
          <Switch on locked title="Siempre hay un stop: el de la sección Stop">Stop inicial</Switch>
          <span className="rt-note">siempre, el de la sección Stop</span>
        </div>
        <Opt id="objetivo" label="Objetivo" on={rule.useTarget} onToggle={(useTarget) => patch({ useTarget })} title="Apagado no hay objetivo: se ve hasta dónde llega">
          <div className="rt-row">
            {!usesProfile(rule) && rule.codes.includes('BE') && (
              <select value={rule.targetAt === 'mid' ? 'mid' : 'r'} onChange={(e) => patch({ targetAt: e.target.value })} title="Dónde va el objetivo">
                <option value="r">en R</option>
                <option value="mid">en el centro de la caja</option>
              </select>
            )}
            {usesProfile(rule) && (
              <select value={rule.targetAt} onChange={(e) => patch({ targetAt: e.target.value })} title="Dónde va el objetivo">
                <option value="r">en R</option>
                <option value="poc">en el POC anterior</option>
                <option value="edge">en el borde contrario del valor</option>
                <option value="mid">en el centro del rango anterior</option>
              </select>
            )}
            {!usesProfile(rule) && !rule.codes.includes('BE') && (
              <select value={rule.targetAt === 'weak' ? 'weak' : 'r'} onChange={(e) => patch({ targetAt: e.target.value })} title="Dónde va el objetivo">
                <option value="r">en R</option>
                <option value="weak">en el máximo o mínimo del rango SMC</option>
              </select>
            )}
            {targetInR(rule) && <><Num value={rule.targetR} min={0.2} max={50} step={0.25} onChange={(targetR) => patch({ targetR })} /><span>R</span></>}
          </div>
          {rule.targetAt === 'weak' && !usesProfile(rule) && !rule.codes.includes('BE') && (
            <div className="rt-note">El máximo (en un largo) o el mínimo (en un corto) del rango mayor SMC en la vela de la señal, donde espera la liquidez del lado débil. Con el objetivo a menos de 0.3 R o ya pasado no se opera.</div>
          )}
          {targetInR(rule) && (
            <Opt sub id="arrastre" label="Arrastrarlo (trailing take profit)" on={rule.tpTrailOn}
              onToggle={(tpTrailOn) => patch({ tpTrailOn, ...(tpTrailOn && !(rule.tpTrailStart <= rule.targetR) ? { tpTrailStart: Math.max(0.25, rule.targetR - 0.5) } : {}) })}
              title="Como un bot: el objetivo queda fijo hasta que el precio llega al arranque; desde ahí sigue al mejor precio y el trade se cierra cuando el precio vuelve hasta él">
              <div className="rt-row">
                <span>se activa al llegar a</span><Num value={rule.tpTrailStart} min={0.1} max={rule.targetR} step={0.25} onChange={(tpTrailStart) => patch({ tpTrailStart })} /><span>R y sigue al mejor precio a</span>
                <Num value={rule.tpTrailDist} min={0.01} max={rule.tpTrailUnit === 'pct' ? 50 : 20} step={rule.tpTrailUnit === 'pct' ? 0.1 : 0.25} onChange={(tpTrailDist) => patch({ tpTrailDist })} />
                <select value={rule.tpTrailUnit} onChange={(e) => patch({ tpTrailUnit: e.target.value })} title="R: del riesgo del trade. ATR: el de la vela de la señal. %: del mejor precio, como el retroceso de un bot">
                  {TP_TRAIL_UNITS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className="rt-note">
                Al llegar a {Math.min(Number(rule.tpTrailStart) || 0, Number(rule.targetR) || 0)} R el objetivo de {rule.targetR} R deja de ser fijo: sigue al mejor precio
                a {tpTrailText({ dist: rule.tpTrailDist, unit: rule.tpTrailUnit })} y el trade se cierra cuando el precio vuelve hasta él, aunque haya pasado el objetivo.
                Se mira dentro de cada vela (minuto a minuto o, sin minutos, su recorrido supuesto), como una orden trailing del exchange. Las entradas al azar usan la misma salida.
              </div>
            </Opt>
          )}
        </Opt>
        <Opt id="trailing" label="Trailing del stop" on={trailingMode !== 'off'} onToggle={toggleTrailing} title="El stop se acerca solo a favor, con cada vela cerrada">
          <div className="rt-row">
            <select value={trailingMode} onChange={(e) => patch({ trail: e.target.value === 'swing', trailMode: e.target.value === 'swing' ? 'off' : e.target.value })}>
              <option value="atr">a N ATR del mejor precio</option>
              <option value="pct">a un % del mejor precio</option>
              <option value="swing">al último swing confirmado de</option>
              <option value="bars">bajo el mínimo de las últimas (Williams)</option>
            </select>
            {(rule.trail || rule.trailMode === 'bars') && <><Num value={rule.trailBars} min={2} max={20} onChange={(trailBars) => patch({ trailBars })} /><span>velas</span></>}
            {!rule.trail && rule.trailMode === 'atr' && <><Num value={rule.trailAtr} min={0.2} max={20} step={0.5} onChange={(trailAtr) => patch({ trailAtr })} /><span>ATR</span></>}
            {!rule.trail && rule.trailMode === 'pct' && <><Num value={rule.trailPct} min={0.05} max={50} step={0.5} onChange={(trailPct) => patch({ trailPct })} /><span>%</span></>}
          </div>
          {!rule.trail && rule.trailMode !== 'bars' && (
            <>
              <Opt sub id="trailStart" label="Empezar al llegar a una ganancia" on={rule.trailStartOn} onToggle={(trailStartOn) => patch({ trailStartOn })}
                title="Hasta llegar a esos R a favor el stop queda en el inicial. Apagado, el trailing corre desde la entrada">
                <div className="rt-row"><span>de</span><Num value={rule.trailStart} min={0} max={20} step={0.5} onChange={(trailStart) => patch({ trailStart })} /><span>R a favor</span></div>
              </Opt>
              <div className="rt-note">
                {!rule.trailStartOn && <><b>Corre desde la entrada.</b> </>}
                Medido con entradas al azar (fase 1, 4h, siete monedas): un trailing ajustado pierde (1 a 3 ATR, de −0.06 a −0.01 R) y uno amplio gana algo solo, porque en 4h hubo tendencias:
                stop de 2 ATR y trailing a 4 ATR, +0.10 R antes de 2023 y +0.04 en 2023. Una regla con trailing tiene que superar ese azar, que el informe ya usa como control.
              </div>
            </>
          )}
        </Opt>
        <Opt id="aLaEntrada" label="Stop a la entrada" on={rule.breakEvenOn} onToggle={(breakEvenOn) => patch({ breakEvenOn })} title="Al llegar a esos R a favor el stop pasa al precio de entrada (sin contar comisiones)">
          <div className="rt-row"><span>al llegar a</span><Num value={rule.breakEven} min={0.1} max={20} step={0.5} onChange={(breakEven) => patch({ breakEven })} /><span>R a favor</span></div>
        </Opt>
        <Opt id="tiempo" label="Cierre por tiempo" on={rule.useHorizon} onToggle={(useHorizon) => patch({ useHorizon })} title="Cierra al cierre de la vela N del trade">
          <div className="rt-row"><span>a las</span><Num value={rule.horizon} min={1} max={2000} onChange={(horizon) => patch({ horizon })} /><span>velas</span></div>
        </Opt>
        <Opt id="contraria" label="Cierre con la señal contraria" on={rule.opposite} onToggle={(opposite) => patch({ opposite })} title="Sale en la apertura siguiente a una señal de la regla del otro lado" />
        {rule.codes.includes('GC') && (
          <Opt id="canal" label="Salida por el canal (Gaussian Channel)" on={rule.gcExit !== 'none'} onToggle={toggleMode('gcExit', 'none', 'band')} title="La salida propia de la estrategia del canal, con la vela cerrada; sale en la apertura siguiente">
            <div className="rt-row">
              <select value={rule.gcExit} onChange={(e) => patch({ gcExit: e.target.value })}>
                <option value="band">al cerrar de vuelta dentro de la banda</option>
                <option value="mid">al cerrar al otro lado de la línea central</option>
              </select>
            </div>
          </Opt>
        )}
        {!rule.useTarget && trailingMode === 'off' && !rule.useHorizon && !(rule.codes.includes('GC') && rule.gcExit !== 'none') && (
          <div className="rt-warn" style={{ marginTop: 4 }}>Sin objetivo, trailing ni cierre por tiempo, el backend cierra cada trade a las 96 velas.</div>
        )}
        <ExitScale marks={exitScale(rule)} />
        <div className="rt-sub">Operación</div>
        <Opt id="unaAlaVez" label="Una posición a la vez" on={rule.oneAtATime} onToggle={(oneAtATime) => patch({ oneAtATime })} title="Encendido: lo que operarías. Apagado: todas las señales, para medir el elemento">
          <div className="rt-row"><span title="Velas de espera después de cerrar un trade antes de tomar otra señal. 0 = sin espera">esperar</span><Num value={rule.cooldown} min={0} max={500} onChange={(cooldown) => patch({ cooldown })} /><span>velas tras cerrar</span></div>
        </Opt>
      </Section>

      <Section id="deteccion" title="Detección de los elementos" summary={summaries.deteccion} open={openSections.deteccion} onToggle={toggleSection}>
        <div className="rt-row">
          <span title="Para los elementos marcados 'vol.': volumen de la vela en veces la mediana de las 20 anteriores">Filtro de volumen</span>
          <Num value={rule.volFilter} min={0} max={10} step={0.5} onChange={(volFilter) => patch({ volFilter })} />
          <span title="Parte de las velas que marca cada elemento relativo">Frecuencia</span>
          <Num value={rule.target} min={0.005} max={0.3} step={0.005} onChange={(target) => patch({ target })} />
        </div>
        <div className="rt-note">Cambiar estos dos obliga a detectar de nuevo los elementos de toda la fase (varios minutos).</div>
      </Section>
    </>
  );

  const s = result?.summary;
  // El formulario cambió desde esta corrida: lo que usó la corrida, y cómo volver a ella (pedido del usuario, 20/11)
  const runNote = result && runDiffs.length > 0 ? (
    <div className="rt-warn">
      <b>El formulario ya no es la regla de esta corrida.</b> Esta corrida usó:
      <ul className="rt-diffs">
        {runDiffs.map(d => (
          <li key={d.key}>
            <button type="button" className="rt-link" onClick={() => goTo(d.key)} title="Ir a ese control en la pestaña Regla">{d.label}</button>: {d.run}{' '}
            <span className="rt-note">(en el formulario: {d.form})</span>
          </li>
        ))}
      </ul>
      <button type="button" className="rt-btn" onClick={() => loadBackendRule(result.rule)} title="Pone en el formulario la regla exacta de esta corrida">Cargar la de la corrida</button>
    </div>
  ) : null;
  // Tras "Correr en todas las monedas" no hay corrida de una moneda abierta: estas pestañas dicen dónde abrirla
  const oneCoinHint = !result && allReport?.phase === phase ? (
    <div className="rt-note">
      Estas pestañas muestran una moneda a la vez. En "Todas", en la tabla "Por moneda", pulsa una moneda para abrir su corrida con sus trades en el gráfico.
    </div>
  ) : null;
  const summaryTab = !result ? (oneCoinHint || <div className="rt-note">Todavía no hay una corrida de esta fase. Arma la regla y córrela.</div>) : (
    <>
      {runNote}
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
      <div className="rt-group">
        <h4>Señales</h4>
        <Funnel steps={signalFunnel(result)} />
        <div className="rt-note">
          {Number(result.signals || 0).toLocaleString('es-CO')} señales en {Number(result.bars || 0).toLocaleString('es-CO')} velas.
          {result.open > 0 && ' Las abiertas al final de la fase no cuentan: su salida cae en la fase siguiente.'}
          {!result.measuresAvailable && ' Sin tabla de medidas para este símbolo: los trades no llevan medidas.'}
        </div>
      </div>
      {!s?.n ? <div className="rt-note">La regla no dejó trades cerrados en esta fase ({result.signals} señales).</div> : (
        <>
          {s.smallSample && <div className="rt-warn">Muestra pequeña ({s.n} trades): con menos de 30 nada se distingue del azar.</div>}
          <ModeSwitch mode={statsMode} onMode={setStatsMode} risk={accountRisk} onRisk={setAccountRisk} />
          {statsMode === 'account' ? <AccountView trades={result.trades} risk={accountRisk} /> : (
          <>
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
          </>
          )}
          {result.baseline?.n > 0 && (
            <div className="rt-group">
              <h4>Contra el azar</h4>
              <table className="rt-table">
                <thead><tr><th></th><th>Trades</th><th>Acierto</th><th>R medio</th></tr></thead>
                <tbody>
                  <tr><td>La regla</td><td>{s.n}</td><td>{fmtPct(s.winRate)}</td><td><R value={s.avgR} digits={3} /></td></tr>
                  <tr><td>Entradas al azar</td><td>{result.baseline.n}</td><td>{fmtPct(result.baseline.winRate)}</td><td><R value={result.baseline.avgR} digits={3} /></td></tr>
                  {result.legBaseline?.n > 0 && (
                    <tr title="Velas al azar, entrando siempre a favor del tramo en curso, con el mismo stop y la misma salida"><td>Seguir el tramo al azar</td><td>{result.legBaseline.n}</td><td>{fmtPct(result.legBaseline.winRate)}</td><td><R value={result.legBaseline.avgR} digits={3} /></td></tr>
                  )}
                </tbody>
              </table>
              {result.edge && (
                <div className="rt-note">
                  Ventaja: <R value={result.edge.r} digits={3} /> R por trade (entre {fmtR(result.edge.low, 3)} y {fmtR(result.edge.high, 3)}).{' '}
                  {result.edge.clear ? 'El margen no incluye el cero.' : 'No se distingue del azar.'} Las entradas al azar usan el mismo stop (si depende del elemento, su distancia mediana en ATR), la misma salida y la misma proporción de largos y cortos.
                </div>
              )}
              {result.legEdge && (
                <div className="rt-note" style={{ marginTop: 4 }}>
                  Contra seguir el tramo al azar: <R value={result.legEdge.r} digits={3} /> R por trade (entre {fmtR(result.legEdge.low, 3)} y {fmtR(result.legEdge.high, 3)}).{' '}
                  {result.legEdge.clear ? 'El margen no incluye el cero.' : 'No se distingue de seguir el tramo.'}{' '}
                  El tramo es el del Volumen de Respuesta: gira cuando un cierre se aleja {result.legBaseline.leg} ATR de su extremo.
                  Si la regla sigue el movimiento, esta es la comparación que importa: dice cuánto pone la señal y cuánto el mercado.
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
  const tradesTab = !result ? (oneCoinHint || <div className="rt-note">Sin corrida en esta fase.</div>) : (
    <>
      {runNote}
      {selectedTrade && (
        <div className="rt-group">
          <b>Trade {selectedTrade.n}</b> · {selectedTrade.dir > 0 ? 'Largo' : 'Corto'} · <R value={selectedTrade.r} /> R · {selectedTrade.reason}
          <div className="rt-note">
            Señal {stamp(selectedTrade.signal)} · entrada {stamp(selectedTrade.entry_t)} ({selectedTrade.order === 'limit' ? 'limit' : 'mercado'}) · salida {stamp(selectedTrade.exit_t)}<br />
            Entrada {selectedTrade.entry} · stop {Number(selectedTrade.stop.toFixed(6))} ({selectedTrade.stop_atr} ATR){selectedTrade.target != null && ` · objetivo ${Number(selectedTrade.target.toFixed(6))}`} · salida {Number(selectedTrade.exit.toFixed(6))}<br />
            Elementos de la regla: {elementLabels(selectedTrade.votes, ', ')} · presentes: {elementLabels(selectedTrade.present, ', ') || '—'} · en contra: {elementLabels(selectedTrade.against, ', ') || '—'}
            {'tp_on' in selectedTrade && <><br />Trailing del objetivo: {selectedTrade.tp_on != null ? `se activó el ${stamp(selectedTrade.tp_on)}; desde ahí el objetivo siguió al mejor precio` : 'el precio no llegó a su arranque'}</>}
            {selectedTrade.vp &&<><br />Sesión anterior ({selectedTrade.vp.hours} h): VAH {selectedTrade.vp.vah} · POC {selectedTrade.vp.poc} · VAL {selectedTrade.vp.val} · perfil {selectedTrade.vp.shape || '—'} · la sesión abrió {selectedTrade.vp.open > 0 ? 'encima del valor' : selectedTrade.vp.open < 0 ? 'debajo del valor' : 'dentro del valor'}</>}
            {selectedTrade.gc && <><br />Canal en la señal: banda superior {selectedTrade.gc.high}, línea central {selectedTrade.gc.mid}, banda inferior {selectedTrade.gc.low}</>}
            {selectedTrade.rv && <><br />{selectedTrade.rv.code === 'RF' ? `Flecha: ${selectedTrade.rv.times} veces el volumen de su hora` : `Rombo: extremo del tramo ${selectedTrade.rv.extreme}`} · tramo {selectedTrade.rv.leg > 0 ? 'alcista' : 'bajista'}</>}
            {selectedTrade.pat && <><br />Patrón: {selectedTrade.pat.type}{selectedTrade.pat.volumeZ != null && ` · volumen z ${selectedTrade.pat.volumeZ}`}</>}
            {selectedTrade.lines?.length > 0 && <><br />{selectedTrade.lines.map(l => `${l.type === 'vwap' ? 'VWAP' : 'EMA'} ${l.period} en ${l.value}`).join(' · ')}</>}
            {selectedTrade.cc && <><br />Cambio de carácter: swing roto en {selectedTrade.cc.level}, extremo de la tendencia en {selectedTrade.cc.extreme}, estructura en velas de {selectedTrade.cc.structTf >= 60 ? `${selectedTrade.cc.structTf / 60} h` : `${selectedTrade.cc.structTf} m`}</>}
            {selectedTrade.liq && <><br />Barrido: {selectedTrade.liq.what === 'zone' ? `zona ${selectedTrade.liq.zoneLow}–${selectedTrade.liq.zoneHigh}` : `swing en ${selectedTrade.liq.swing} de hace ${selectedTrade.liq.swingAgeBars} velas`}, pasado hasta {selectedTrade.liq.extreme}{selectedTrade.liq.depthAtr != null && ` (${selectedTrade.liq.depthAtr} ATR)`} · zona de {Math.round((selectedTrade.liq.usd || 0) / 1000).toLocaleString('es-CO')}K USD ({selectedTrade.liq.zoneSide === 'long' ? 'largos' : 'cortos'} liquidados), última liquidación {selectedTrade.liq.zoneAgeDays} días antes · {selectedTrade.liq.source}</>}
          </div>
          {(() => {
            const used = tradeContext?.runId === result.id && tradeContext?.n === selectedTrade.n ? tradeContext : null;
            const skipped = skippedSignals(used);
            const taken = (used?.signals || []).length - skipped.length;
            const check = signalChecklist(used, selectedTrade, result.rule.recipe, names);
            const mark = (ok) => (ok === true ? '✓' : ok === false ? '✗' : '–');
            const markColor = (ok) => (ok === true ? tone(1) : ok === false ? tone(-1) : undefined);
            return (
              <div className="rt-note" style={{ marginTop: 4 }}>
                <label style={{ cursor: 'pointer' }} title="Sus líneas enteras, todas las apariciones de sus elementos (tenues), una fila por filtro bajo las velas y las señales de la regla">
                  <input type="checkbox" checked={showContext} onChange={(e) => setShowContext(e.target.checked)} /> Ver en el gráfico lo que usó la regla
                </label>
                {used?.loading && <> · repitiendo la regla para dibujarlo…</>}
                {used && used.success === false && !used.loading && <> · no se pudo: {used.message || 'sin respuesta'}</>}
                {used?.same === false && <><br /><b>Ojo:</b> al repetir hoy la regla, esta señal no da el mismo trade (la corrida es del motor {used.engine}; hoy, el {used.engineNow}). Lo dibujado es lo de hoy.</>}
                {check && (
                  <>
                    <div style={{ marginTop: 6 }}>
                      <b>{check.all ? 'Al cerrar la vela de la señal se cumplía todo' : 'Al cerrar la vela de la señal no se cumplía todo'}</b> ({stamp(check.time)}; entró en la apertura siguiente, {stamp(selectedTrade.entry_t)}):
                    </div>
                    <table className="rt-table">
                      <tbody>
                        {check.items.map((item) => (
                          <tr key={item.label}>
                            <td style={{ color: markColor(item.ok), fontWeight: 700, width: 14 }}>{mark(item.ok)}</td>
                            <td>{item.label}</td>
                            <td>{item.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div>En el gráfico, la vela de la señal va resaltada con este mismo cuadro y su casilla en cada fila de filtros (verde pasa, rojo no pasa, gris sin dato). Los triángulos son las señales de la regla: rellenos los que dieron trade.</div>
                    <details style={{ marginTop: 4 }}>
                      <summary style={{ cursor: 'pointer' }}>Señales en la ventana: {taken} con trade y {skipped.length} sin entrar</summary>
                      {skipped.length > 0 ? (
                        <table className="rt-table">
                          <tbody>
                            {skipped.map((s, i) => <tr key={`${s.t}-${s.dir}-${i}`}><td>{stamp(s.t)}</td><td>{s.dir > 0 ? 'largo' : 'corto'}</td><td>{s.what}</td></tr>)}
                          </tbody>
                        </table>
                      ) : <div>Todas las señales de la ventana dieron trade.</div>}
                    </details>
                  </>
                )}
              </div>
            );
          })()}
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
              <td>{t.reach ?? '—'}</td><td>{t.bars}</td><td>{t.reason}</td><td>{elementLabels(t.votes, ', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > shown && <button type="button" className="rt-btn" onClick={() => setShown(n => n + PAGE)}>Mostrar {Math.min(PAGE, sorted.length - shown)} más ({sorted.length - shown} restantes)</button>}
    </>
  );

  const b = result?.breakdowns;
  const wl = result?.winnersVsLosers;
  const patternsTab = !result || !s?.n ? (oneCoinHint || <div className="rt-note">Sin trades en esta fase.</div>) : (
    <>
      <BriefTable title="Por año" rows={b.year} />
      <BriefTable title="Por lado" rows={b.side} />
      <BriefTable title="Por hora de entrada (UTC)" rows={b.hour} />
      <BriefTable title="Por salida" rows={b.reason} />
      <BriefTable title="Por forma del perfil de la sesión anterior" rows={b.vpShape} first="D medio · P arriba · b abajo · B doble" />
      <BriefTable title="Por forma del perfil y lado" rows={b.vpShapeSide} />
      <BriefTable title="Por apertura de la sesión frente al valor anterior" rows={b.vpOpen} />
      <BriefTable title="Por combinación de elementos de la regla" rows={b.combo} labels />
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
                <button type="button" className="rt-btn" onClick={() => { loadBackendRule(run.rule); setTab('regla'); }} title="Cargar esta regla en el editor">Regla</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!info?.runs?.length && <div className="rt-note">Sin corridas todavía.</div>}
    </>
  );

  const a = allReport?.summary;
  const allTab = !allReport ? (
    <div className="rt-note">Todavía no hay un informe de todas las monedas. Arma la regla y usa "Correr en todas las monedas": corre la fase elegida en cada una y junta los trades.</div>
  ) : (
    <>
      <div className="rt-group">
        <b>{allReport.rule.name}</b> · Fase {allReport.phase} · {allReport.symbols.length} monedas{allReport.group === 'new' ? ' nuevas' : allReport.group === 'all' ? ' (las de siempre y las nuevas)' : allReport.group === 'stocks' ? ' (acciones)' : ' de siempre'}
        <div className="rt-note">{describeRule(allReport.rule)}</div>
      </div>
      {allReport.phase > 1 && <div className="rt-warn">Esta fase es de comprobación. Si cambias la regla por lo que veas aquí, la fase queda gastada para la regla nueva en todas las monedas.</div>}
      {!a?.n ? <div className="rt-note">La regla no dejó trades cerrados en esta fase.</div> : (
        <>
          {a.smallSample && <div className="rt-warn">Muestra pequeña ({a.n} trades): con menos de 30 nada se distingue del azar.</div>}
          <ModeSwitch mode={statsMode} onMode={setStatsMode} risk={accountRisk} onRisk={setAccountRisk} />
          {statsMode === 'account' ? (allReport.trades
            ? <AccountView trades={allReport.trades} risk={accountRisk} />
            : <div className="rt-note">Este informe se armó antes de tener la vista como cuenta: pulsa otra vez "Correr en todas las monedas" (no recalcula nada).</div>
          ) : (
          <>
          <div className="rt-cards">
            <div className="rt-card"><b>{a.n}</b><span>Trades cerrados</span></div>
            <div className="rt-card"><b>{fmtPct(a.winRate)}</b><span>Acierto ({a.wilson?.[0]}–{a.wilson?.[1]}%)</span></div>
            <div className="rt-card"><b><R value={a.avgR} digits={3} /></b><span>R medio neto</span></div>
            <div className="rt-card"><b><R value={a.totalR} /></b><span>R total</span></div>
            <div className="rt-card"><b>{a.profitFactor ?? '—'}</b><span>Profit factor</span></div>
            <div className="rt-card"><b>{allReport.positive} de {allReport.withTrades}</b><span>Monedas con R medio positivo</span></div>
          </div>
          <Equity points={allReport.equity} />
          <div className="rt-note">Curva de todos los trades en orden de salida, con 1 R por trade. Las monedas operan a la vez: no es la curva de una sola cuenta (para eso, "Como cuenta").</div>
          </>
          )}
          {allReport.baseline && (
            <div className="rt-group">
              <h4>Contra el azar</h4>
              <table className="rt-table">
                <thead><tr><th></th><th>Trades</th><th>Acierto</th><th>R medio</th></tr></thead>
                <tbody>
                  <tr><td>La regla</td><td>{a.n}</td><td>{fmtPct(a.winRate)}</td><td><R value={a.avgR} digits={3} /></td></tr>
                  <tr><td>Entradas al azar</td><td>—</td><td>{fmtPct(allReport.baseline.winRate)}</td><td><R value={allReport.baseline.avgR} digits={3} /></td></tr>
                  {allReport.legBaseline && (
                    <tr title="Velas al azar, entrando siempre a favor del tramo en curso, con el mismo stop y la misma salida"><td>Seguir el tramo al azar</td><td>—</td><td>{fmtPct(allReport.legBaseline.winRate)}</td><td><R value={allReport.legBaseline.avgR} digits={3} /></td></tr>
                  )}
                </tbody>
              </table>
              {allReport.edge && (
                <div className="rt-note" style={{ marginTop: 4 }}>
                  Ventaja: <R value={allReport.edge.r} digits={3} /> R por trade (entre {fmtR(allReport.edge.low, 3)} y {fmtR(allReport.edge.high, 3)}).{' '}
                  {allReport.edge.clear ? 'El margen no incluye el cero.' : 'No se distingue del azar.'} El azar de cada moneda pesa según los trades que la regla hizo en ella.
                </div>
              )}
              {allReport.legEdge && (
                <div className="rt-note" style={{ marginTop: 4 }}>
                  Contra seguir el tramo al azar: <R value={allReport.legEdge.r} digits={3} /> R por trade (entre {fmtR(allReport.legEdge.low, 3)} y {fmtR(allReport.legEdge.high, 3)}).{' '}
                  {allReport.legEdge.clear ? 'El margen no incluye el cero.' : 'No se distingue de seguir el tramo.'}{' '}
                  El tramo es el del Volumen de Respuesta: gira cuando un cierre se aleja {allReport.legBaseline.leg} ATR de su extremo.
                  Si la regla sigue el movimiento, esta es la comparación que importa: dice cuánto pone la señal y cuánto el mercado.
                </div>
              )}
            </div>
          )}
          {a.reach && (
            <div className="rt-group">
              <h4>Hasta dónde llegó antes del stop inicial</h4>
              <table className="rt-table">
                <thead><tr><th></th>{Object.keys(a.reach).map(level => <th key={level}>≥ {level}R</th>)}</tr></thead>
                <tbody>
                  <tr><td>La regla</td>{Object.keys(a.reach).map(level => <td key={level}>{fmtPct(a.reach[level])}</td>)}</tr>
                  {allReport.baseline?.reach && <tr><td>Al azar</td>{Object.keys(a.reach).map(level => <td key={level}>{fmtPct(allReport.baseline.reach[level])}</td>)}</tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <div className="rt-group">
        <h4>Por moneda</h4>
        <table className="rt-table">
          <thead><tr><th>Moneda</th><th>Trades</th><th>Acierto</th><th>R medio</th><th>R total</th><th title="R medio de la regla menos el de las entradas al azar">Vs. azar</th><th title="R medio de la regla menos el de seguir el tramo al azar">Vs. tramo</th></tr></thead>
          <tbody>
            {allReport.symbols.map(row => (
              <tr key={row.symbol} title={`${row.from} a ${row.to} · azar ${fmtR(row.baseR, 3)} R${row.legR != null ? ` · seguir el tramo al azar ${fmtR(row.legR, 3)} R` : ''}${row.edge ? ` · contra el azar, entre ${fmtR(row.edge.low, 3)} y ${fmtR(row.edge.high, 3)}` : ''}`}>
                <td>{row.symbol === symbol
                  ? <button type="button" className="rt-btn" onClick={() => loadRun(row.run)} title="Ver esta corrida con sus trades en el gráfico">{row.symbol.replace('USDT', '')}</button>
                  : <a className="rt-btn" style={{ textDecoration: 'none' }} href={`?${TESTER_PARAM}=1&symbol=${row.symbol}${row.run ? `&run=${row.run}` : ''}`} title="Abrir esta moneda con esta corrida y sus trades en el gráfico">{row.symbol.replace('USDT', '')}</a>}</td>
                <td>{row.n}</td><td>{fmtPct(row.winRate)}</td><td><R value={row.avgR} digits={3} /></td><td><R value={row.totalR} /></td>
                <td><R value={row.edge?.r} digits={3} /></td><td><R value={row.legEdge?.r} digits={3} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {allReport.plan.some(row => row.action === 'skip') && (
          <div className="rt-note" style={{ marginTop: 4 }}>No entraron: {allReport.plan.filter(row => row.action === 'skip').map(row => `${row.symbol.replace('USDT', '')} (${row.reason})`).join('; ')}.</div>
        )}
      </div>
      {allReport.consistency?.total > 0 && (
        <div className="rt-group">
          <h4>Constancia por trimestre</h4>
          <div className="rt-note" style={{ marginBottom: 4 }}>
            Cada trade contra el azar de su trimestre y su lado, en su moneda. <b>{allReport.consistency.positive} de {allReport.consistency.total}</b> trimestres
            quedan sobre el azar; la mediana es <R value={allReport.consistency.median} digits={2} /> R por trade
            {allReport.consistency.top4Share != null ? <>, y los 4 mejores ponen <b>{Math.round(allReport.consistency.top4Share * 100)}%</b> de la ventaja total</> : ', y la ventaja total no es positiva'}.
            {allReport.consistency.top4Share != null && allReport.consistency.top4Share >= 0.8 && allReport.consistency.total > 5
              && ' Depende de pocos trimestres: en un periodo sin ellos puede no ganar.'}
            {' '}Solo cuentan los trimestres con 20 trades o más.
          </div>
          <table className="rt-table">
            <thead><tr><th>Trimestre</th><th>Trades</th><th>R medio</th><th>Vs. azar</th><th>Ventaja total</th></tr></thead>
            <tbody>
              {allReport.consistency.rows.map(row => (
                <tr key={row.quarter}><td>{row.quarter.replace('T', ' T')}</td><td>{row.n}</td><td><R value={row.avgR} digits={2} /></td><td><R value={row.edge} digits={2} /></td><td><R value={row.edgeR} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <BriefTable title="Por año" rows={allReport.byYear} first="Año" />
      <BriefTable title="Por lado" rows={allReport.bySide} first="Lado" />
    </>
  );

  const STATUS = { closed: 'cerrada', open: 'abierta', cancelled: 'cancelada' };
  // ==================== Revisión de candidatos ====================

  const reviewSummary = (s) => !s ? null : (
    <>
      <table className="rt-table">
        <thead><tr><th style={{ textAlign: 'left' }}></th><th>Trades</th><th>Acierto</th><th>R medio</th><th>R total</th></tr></thead>
        <tbody>
          {[['Tus trades', s.taken, 'Lo que entraste, con tu lado, tu stop y tu objetivo'],
            ['Esos mismos, como la regla', s.takenAsRule, 'Los candidatos que tomaste, con el stop y la salida de la regla'],
            ['Los que dejaste pasar', s.skipped, 'Lo que hizo la regla en los candidatos que no tomaste'],
            ['La regla en todos', s.rule, 'Tomar todos los candidatos como propone la regla']].map(([label, stat, title]) => (
            <tr key={label} title={title}><td style={{ textAlign: 'left' }}>{label}</td><td>{stat.n}</td><td>{stat.n ? fmtPct(stat.winRate) : '—'}</td>
              <td>{stat.n ? <><R value={stat.avgR} digits={2} />{stat.margin != null ? <span className="rt-note"> ±{stat.margin.toFixed(2)}</span> : null}</> : '—'}</td>
              <td>{stat.n ? <R value={stat.totalR} digits={1} /> : '—'}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="rt-note" style={{ marginBottom: 6 }}><b>Lo que agrega elegir</b> (lo tomado contra lo dejado, los dos medidos como la regla): {gapText(s.selection, fmtR)}</div>
      <div className="rt-note" style={{ marginBottom: 8 }}><b>Tu criterio completo contra la regla</b> (tus trades contra tomar todos): {gapText(s.overRule, fmtR)}</div>
      {s.byPosition?.length > 0 && (
        <>
          <h4>Por lugar en la sesión</h4>
          <table className="rt-table">
            <thead><tr><th style={{ textAlign: 'left' }}>Candidatos</th><th>Decisiones</th><th>Tus trades</th><th>Dejados</th><th>La regla</th><th title="Mediana de segundos por decisión">Seg.</th></tr></thead>
            <tbody>
              {s.byPosition.map(g => (
                <tr key={g.label}><td style={{ textAlign: 'left' }}>{g.label}</td><td>{g.decisions}</td>
                  <td>{g.taken.n ? <>{g.taken.n} · <R value={g.taken.avgR} digits={2} /></> : '—'}</td>
                  <td>{g.skipped.n ? <>{g.skipped.n} · <R value={g.skipped.avgR} digits={2} /></> : '—'}</td>
                  <td><R value={g.rule.avgR} digits={2} /></td><td>{g.seconds != null ? Math.round(g.seconds) : '—'}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="rt-note" style={{ marginBottom: 8 }}>Si los primeros candidatos de cada sesión rinden peor que los siguientes, ir leyendo el mercado te ayuda. Cada casilla: trades · R medio.</div>
        </>
      )}
    </>
  );

  const reviewPlan = reviewOn ? boxDecision(latestFreeBox(reviewShapes, [...usedBoxesRef.current].map(id => ({ status: 'open', tpslBoxId: id }))), review.candidate.entry, reviewLimit ? 'limit' : 'market') : null;
  const reviewTab = (
    <>
      {!review?.session && (
        <>
          <div className="rt-note" style={{ marginBottom: 8 }}>
            La regla de la pestaña "Regla" propone momentos y tú decides en cada uno si entras, sin ver lo que sigue. Una sesión es un tramo seguido
            de la fase 1, con la fecha y el precio ocultos: decides un candidato, el gráfico avanza hasta el siguiente y ves cómo terminó lo anterior.
            Sirve para medir qué agrega tu criterio sobre la regla. Conviene una regla floja, que proponga mucho.
          </div>
          <div className="rt-row">
            <span>Tramo de</span><Num value={reviewDays} min={7} max={120} onChange={setReviewDays} /><span>días</span>
            <Check checked={reviewAny} onChange={setReviewAny} title="Elige al azar entre las monedas que ya corrieron esta regla en la fase 1. La ventana cambia a esa moneda">moneda al azar</Check>
          </div>
          <button type="button" className="rt-btn primary" style={{ width: '100%', padding: '6px 0', margin: '6px 0 10px' }} disabled={reviewBusy} onClick={startReview}>
            {reviewBusy ? 'Buscando un tramo…' : 'Empezar una sesión de revisión'}
          </button>
        </>
      )}
      {reviewOn && blindShown !== review.session.id && <div className="rt-note" style={{ marginBottom: 8 }}>Preparando el gráfico de la sesión…</div>}
      {reviewOn && blindShown === review.session.id && (
        <>
          <div className="rt-warn">
            <b>Candidato {review.session.position + 1} de {review.session.total}</b> · {review.session.name} · {TF_LABEL[review.session.tf]}<br />
            {review.decisions.length > 0 && <>Ya estás en el candidato siguiente: es la última vela del gráfico, marcada "Candidato {review.candidate.i + 1}". Decide aquí y el gráfico vuelve a avanzar.<br /></>}
            La regla propone un <b>{review.candidate.dir > 0 ? 'largo' : 'corto'}</b>{review.candidate.votes?.length ? ` (${elementLabels(review.candidate.votes, ', ')})` : ''}:
            {' '}entrada {priceText(review.candidate.entry)}, stop {priceText(review.candidate.stop)}{review.candidate.target != null ? `, objetivo ${priceText(review.candidate.target)}` : ', sin objetivo fijo'}.
          </div>
          <button type="button" className="rt-btn primary" style={{ width: '100%', padding: '6px 0' }} disabled={reviewBusy} onClick={() => decideReview('rule')}>Entro como propone la regla</button>
          <button type="button" className="rt-btn" style={{ width: '100%', padding: '6px 0', marginTop: 4 }} disabled={reviewBusy || !reviewPlan || !!reviewPlan.problem}
            onClick={() => decideReview(reviewPlan.action, reviewPlan)} title="Usa el lado, la entrada, el stop y el objetivo de la última caja TP/SL que dibujaste">
            {reviewPlan && !reviewPlan.problem ? `Entro con mi caja: ${reviewPlan.side > 0 ? 'largo' : 'corto'} ${reviewPlan.limit != null ? `limit en ${priceText(reviewPlan.limit)}` : 'a mercado'}, stop ${priceText(reviewPlan.stop)}, objetivo ${priceText(reviewPlan.target)} (${reviewPlan.rr.toFixed(1)} a 1)` : 'Entro con mi caja TP/SL'}
          </button>
          {reviewPlan?.problem && <div className="rt-note" style={{ marginTop: 2 }}>{reviewPlan.problem}.</div>}
          <div className="rt-row" style={{ marginTop: 4 }}>
            <button type="button" className={`rt-btn${tool === 'tpsl' ? ' on' : ''}`} style={{ flex: 1 }} onClick={() => setTool(tool === 'tpsl' ? 'select' : 'tpsl')}>Dibujar caja larga</button>
            <button type="button" className={`rt-btn${tool === 'tpsl-short' ? ' on' : ''}`} style={{ flex: 1 }} onClick={() => setTool(tool === 'tpsl-short' ? 'select' : 'tpsl-short')}>Dibujar caja corta</button>
          </div>
          <button type="button" className="rt-btn" style={{ width: '100%', padding: '6px 0', marginTop: 4 }} disabled={reviewBusy} onClick={() => decideReview('skip')}>No entro</button>
          <div className="rt-row" style={{ marginTop: 4 }}>
            <Check checked={reviewLimit} onChange={setReviewLimit} title="Marcada: la orden espera en el precio de entrada de tu caja, las velas que digas, y se llena cuando el precio lo cruza; si no llega, queda sin llenar. Si el mercado ya está mejor que ese precio, entra a mercado. Sin marcar: entra a mercado en la apertura de la vela siguiente, y de la caja solo usa el stop y el objetivo">Entrar en el precio de mi caja (limit)</Check>
            <span>y esperar</span><Num value={reviewWait} min={1} max={500} disabled={!reviewLimit} onChange={setReviewWait} /><span>velas ({Math.round((Number(reviewWait) || 0) * review.session.tf / 6) / 10} h)</span>
          </div>
          <div className="rt-row">
            <Check checked={reviewFollow} onChange={setReviewFollow} title="Como al operar una posición a la vez: tras entrar, el gráfico avanza hasta que tu trade cierra y unas velas más, para ver cómo terminó y qué hizo el precio después. Los candidatos que caen en ese tramo no se deciden. Sin marcar, pasa al candidato siguiente aunque el trade siga abierto">Tras entrar, seguir hasta que el trade cierre</Check>
          </div>
          <div className="rt-note" style={{ margin: '6px 0 10px' }}>
            El gráfico llega hasta el cierre de la vela del candidato. Puedes moverte hacia atrás, cambiar de marco, usar tus indicadores y dibujar (botón "Dibujo", arriba).
            Fecha y precio están ocultos; el resultado de cada decisión aparece cuando un candidato posterior ya lo dejó atrás.
          </div>
        </>
      )}
      {review?.session?.done && (
        <>
          <div className="rt-warn">
            <b>Sesión terminada</b> · {review.summary?.decisions ?? review.session.position} candidatos decididos de {review.session.total}{review.summary?.passed ? `, ${review.summary.passed} pasaron con un trade abierto` : ''}{review.summary?.unfilled ? `, ${review.summary.unfilled} órdenes sin llenar` : ''}.{' '}
            <button type="button" className="rt-btn" onClick={closeReview}>Cerrar la sesión</button>
          </div>
          {reviewSummary(review.summary)}
        </>
      )}
      {review?.session && review.decisions.length > 0 && (
        <>
          <h4>Decisiones de esta sesión</h4>
          <div className="rt-note" style={{ marginBottom: 4 }}>El gráfico muestra solo la caja de tu última orden: el trade, o la orden como la pediste si no se llenó. Un clic en otra fila lleva ahí y muestra la suya.</div>
          <table className="rt-table">
            <thead><tr><th style={{ textAlign: 'left' }}>#</th><th style={{ textAlign: 'left' }}>Decisión</th><th>Tu R</th><th title="Lo que hizo la regla en ese candidato">La regla</th></tr></thead>
            <tbody>
              {[...review.decisions].reverse().map(d => (
                <tr key={d.i} style={{ cursor: 'pointer', fontWeight: d.i === reviewPick ? 600 : undefined }} onClick={() => { setReviewPick(d.i); chartRef.current?.focusOn?.(d.time, d.entry ?? null); }} title="Ir a ese momento en el gráfico y mostrar la caja de ese trade">
                  <td style={{ textAlign: 'left' }}>{d.i + 1}</td>
                  <td style={{ textAlign: 'left' }}>{ACTION_LABEL[d.action]}{d.action === 'rule' ? (d.dir > 0 ? ' (largo)' : ' (corto)') : ''}</td>
                  <td>{d.action === 'skip' || d.action === 'passed' ? '—' : (d.unfilled ? 'sin llenar' : d.pending ? 'pendiente' : d.r != null ? <R value={d.r} digits={2} /> : 'abierto')}</td>
                  <td>{d.ruleR != null ? <R value={d.ruleR} digits={2} /> : 'abierto'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {reviewOn && <button type="button" className="rt-btn" style={{ width: '100%', marginBottom: 10 }} disabled={reviewBusy} onClick={endReview} title="Lo decidido hasta aquí queda en el informe">Terminar la sesión aquí</button>}
      {!reviewOn && reviewReport && (
        <>
          <h4>Todas tus sesiones ({reviewReport.sessions.length})</h4>
          {reviewReport.decisions === 0 ? <div className="rt-note">Todavía no hay decisiones registradas.</div> : (
            <>
              {reviewReport.smallSample && <div className="rt-note" style={{ marginBottom: 6 }}>Muestra pequeña: con menos de 30 trades tomados, esto solo describe. Para saber si tu criterio agrega hacen falta unas 150 decisiones.</div>}
              {reviewSummary(reviewReport)}
              <div className="rt-note" style={{ marginBottom: 8 }}>
                Tras un trade ganado: {statText(reviewReport.afterWin, fmtR)}. Tras uno perdido: {statText(reviewReport.afterLoss, fmtR)}. (trades · acierto · R medio)
              </div>
              <table className="rt-table">
                <thead><tr><th style={{ textAlign: 'left' }}>Sesión</th><th>Decididos</th><th>Tus trades</th><th>La regla</th></tr></thead>
                <tbody>
                  {reviewReport.sessions.map(s => (
                    <tr key={s.id}><td style={{ textAlign: 'left' }}>{s.symbol} · {TF_LABEL[s.tf]} · {new Date(s.at).toLocaleDateString('es-CO')}{s.done ? '' : ' · sin terminar'}<br /><span className="rt-note">{s.name}</span></td>
                      <td>{s.decided} de {s.total}</td>
                      <td>{s.taken.n ? <>{s.taken.n} · <R value={s.taken.avgR} digits={2} /></> : '—'}</td>
                      <td>{s.rule.n ? <R value={s.rule.avgR} digits={2} /> : '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </>
  );

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

  const tabs = [['regla', 'Regla'], ['resumen', 'Resumen'], ['trades', `Trades${trades.length ? ` ${trades.length}` : ''}`], ['patrones', 'Patrones'], ['todas', 'Todas'], ['estrategias', 'Estrategias'], ['historial', 'Historial'], ['ordenes', 'Mis órdenes'], ['revision', 'Revisión'], ['busqueda', 'Búsqueda'], ['regimen', 'Régimen']];
  const enabledCount = Object.values(indicatorStates).filter(Boolean).length;

  return (
    <div className="rt-root">
      <div className="rt-head">
        <a className="rt-btn" href={window.location.pathname} title="Volver al menú de inicio de App 1" style={{ textDecoration: 'none' }}>← Inicio</a>
        {info?.symbols?.length > 1 ? (
          <select value={symbol} title="Moneda. Las que no tienen almacén de trades solo corren los elementos hechos con velas"
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
          <button type="button" className={`rt-btn${tool !== 'select' ? ' on' : ''}`} onClick={() => { setShowDraw(open => !open); setShowList(false); }}
            title="Herramientas de dibujo. Supr borra el dibujo elegido">Dibujo{tool !== 'select' ? `: ${DRAW_TOOLS.find(([id]) => id === tool)?.[1] || ''}` : ''}</button>
          {showDraw && (
            <div className="rt-menu" style={{ left: 'auto', right: 0, minWidth: 190 }}>
              {DRAW_TOOLS.map(([id, label]) => (
                <button key={id} type="button" className={`rt-btn${tool === id ? ' on' : ''}`} style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 2 }}
                  onClick={() => { setTool(id); setShowDraw(false); }}>{label}</button>
              ))}
              <div style={{ display: 'flex', gap: 2, marginTop: 6 }}>
                <button type="button" className="rt-btn" style={{ flex: 1 }} onClick={() => chartRef.current?.undo?.()}>Deshacer</button>
                <button type="button" className="rt-btn" style={{ flex: 1 }} onClick={() => chartRef.current?.redo?.()}>Rehacer</button>
              </div>
              <button type="button" className="rt-btn" style={{ width: '100%', marginTop: 2 }} onClick={() => { if (window.confirm('¿Borrar todos los dibujos del gráfico?')) clearDrawings(); setShowDraw(false); }}>Borrar todos</button>
              <div className="rt-note" style={{ marginTop: 6 }}>Los dibujos siguen al cambiar de marco y se pierden al cerrar la ventana. Una sesión de revisión nueva empieza sin dibujos.</div>
            </div>
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <button type="button" className="rt-btn" onClick={() => { setShowList(open => !open); setShowDraw(false); }}>Indicadores {enabledCount}</button>
          {showList && (
            <div className="rt-menu" style={{ left: 'auto', right: 0, width: 'min(460px, calc(100vw - 24px))' }}>
              {/* Dos columnas (21/11/2026): con los indicadores de Williams y SMC la lista era muy larga */}
              <div style={{ columnCount: 2, columnGap: 16 }}>
              {INDICATORS.map(name => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', padding: '3px 0', breakInside: 'avoid' }}>
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
              </div>
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
            {tab === 'todas' && allTab}
            {tab === 'historial' && historyTab}
            {tab === 'ordenes' && ordersTab}
            {tab === 'revision' && reviewTab}
            {tab === 'regimen' && <RegimeTab symbol={symbol} chartTf={chartTf} onBands={setRegimeBands} onFocus={(time, price) => { setPhase(1); focusLater(time, price); }} />}
            {tab === 'estrategias' && (
              <StrategiesTab onLoadRule={(saved) => { loadBackendRule(saved); setPhase(1); setTab('regla'); }}
                onOpenReport={(saved, phaseNumber, group) => {
                  // El informe "Todas" de esas monedas y esa fase, con lo ya corrido: no se recalcula nada
                  coinGroupRef.current = group;
                  setCoinGroup(group);
                  allRuleRef.current = saved;
                  loadAll(saved, phaseNumber);
                }} />
            )}
            {tab === 'busqueda' && <RuleSearchTab onLoadRule={(saved) => { loadBackendRule(saved); setPhase(1); setTab('regla'); }} />}
          </div>
          <div style={{ padding: 8, borderTop: '1px solid var(--t-line, #ddd)', flexShrink: 0 }}>
            {tab === 'regla' && (
              <div className={`rt-plan${planOpen ? '' : ' closed'}`}>
                <button type="button" className="rt-plan-head" onClick={() => setPlanOpen(open => !open)} aria-expanded={planOpen}
                  title={planOpen ? 'Plegar: deja más lugar a la regla' : 'Abrir: la regla completa en palabras, con una × para quitar cada filtro o salida'}>
                  <span className="rt-sec-caret">{planOpen ? '▾' : '▸'}</span>
                  <span><b>Vas a correr</b> · {symbol} · {TF_LABEL[rule.tf] || rule.tf} · fase {phase}
                    {!planOpen && <> · {counts.filtros ? `${counts.filtros} ${counts.filtros === 1 ? 'filtro' : 'filtros'}` : 'sin filtros'} · {counts.salida || 0} {counts.salida === 1 ? 'salida' : 'salidas'} además del stop</>}
                  </span>
                </button>
                {planOpen && (
                  <>
                    <button type="button" className="rt-plan-recipe" onClick={() => goTo('elementos')} title="Ir a los elementos">
                      {rule.codes.length ? planRecipe : 'Sin elementos: elige al menos uno'}
                    </button>
                    <div className="rt-plan-chips">
                      {planChips.map(facet => (
                        <span key={facet.key} className={`rt-pchip${facet.implicit ? ' implicit' : ''}${['entrada', 'stop', 'deteccion', 'unaAlaVez'].includes(facet.key) ? ' base' : ''}`}
                          title={facet.implicit ? 'Lo pone el backend: sin otra salida, cierra cada trade a las 96 velas' : `${facet.label}: clic para ir a su control`}>
                          <button type="button" className="rt-pchip-go" onClick={() => goTo(facet.key)}>{facetPhrase(facet)}</button>
                          {OFF_PATCH[facet.key] && !facet.implicit && (
                            <button type="button" className="rt-pchip-x" onClick={() => turnOff(facet.key)} title={`Quitar: ${facet.label}`} aria-label={`Quitar ${facet.label}`}>×</button>
                          )}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <button type="button" className="rt-btn primary" style={{ width: '100%', padding: '6px 0' }} disabled={running || !phaseInfo?.available} onClick={() => runPhase(false)}>
              {running ? `${job.stage}… ${job.done}/${job.total}` : `Correr la regla en la fase ${phase}`}
            </button>
            <div className="rt-row" style={{ marginTop: 6, marginBottom: 0 }}>
              <span title="Las de siempre son las 7 de App 1, con las que se han elegido las reglas. Las nuevas nunca se usaron para elegir nada: comprobar ahí una regla es como tener datos frescos en todas sus fechas">Monedas</span>
              <select value={coinGroup} disabled={running || allStarting} onChange={(e) => { setCoinGroup(e.target.value); setAllReport(null); }}>
                <option value="base">las de siempre ({info?.baseSymbols?.length ?? 7})</option>
                <option value="new">las nuevas ({info?.newSymbols?.length ?? 0})</option>
                <option value="all">todas las monedas ({(info?.baseSymbols?.length ?? 7) + (info?.newSymbols?.length ?? 0)})</option>
                <option value="stocks">las acciones ({info?.stockSymbols?.length ?? 0})</option>
              </select>
            </div>
            <button type="button" className="rt-btn" style={{ width: '100%', padding: '5px 0', marginTop: 4 }} disabled={running || allStarting} onClick={() => runAll(false)}
              title="Corre esta fase en cada moneda con velas guardadas, una tras otra, y junta los trades en un solo informe">
              {allStarting ? 'Preparando: revisando qué falta en cada moneda…' : running && job.all ? `Todas las monedas: ${job.symbolsDone ?? 0} de ${job.symbolsTotal ?? '…'}` : `Correr en todas las monedas (fase ${phase})`}
            </button>
            {running && <div className="rt-progress"><div style={{ width: `${Math.round(100 * job.done / Math.max(1, job.total))}%` }} /></div>}
            {running && <div className="rt-note" style={{ marginTop: 4 }}>La primera corrida de cada marco y fase detecta los elementos de todo el tramo y tarda varios minutos. Las siguientes, segundos.</div>}
          </div>
        </div>

        <div className="rt-chart backtesting-main" onMouseDown={() => { setShowList(false); setShowDraw(false); }}>
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
                key={chartKey}
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
                onDrawingsChange={keepDrawings}
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
