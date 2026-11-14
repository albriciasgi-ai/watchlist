import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MiniChart from '@app1/components/MiniChart';
import DrawingSidebar from '@app1/components/drawing/DrawingSidebar';
import TimeframeTabs from '@app1/components/backtesting/TimeframeTabs';
import VolumeProfileSettings from '@app1/components/VolumeProfileSettings';
import RangeDetectionSettings from '@app1/components/RangeDetectionSettings';
import RejectionPatternSettings from '@app1/components/RejectionPatternSettings';
import SupportResistanceSettings from '@app1/components/SupportResistanceSettings';
import SupportResistance2Settings from '@app1/components/SupportResistance2Settings';
import VWAPSettings from '@app1/components/VWAPSettings';
import DoubleTopBottomSettings from '@app1/components/DoubleTopBottomSettings';
import SwingDetectorSettings from '@app1/components/SwingDetectorSettings';
import OIVolumeConfluenceSettings from '@app1/components/OIVolumeConfluenceSettings';
import OrderFlowSettings from '@app1/components/OrderFlowSettings';
import FVGSettings from '@app1/components/FVGSettings';
import LiquidationsSettings from '@app1/components/LiquidationsSettings';
import OrderFlowElementsSettings from '@app1/components/OrderFlowElementsSettings';
import OrderFlowSetupsSettings from '@app1/components/OrderFlowSetupsSettings';
import VPPeriodicSettings from '@app1/components/VPPeriodicSettings';
import ResponseVolumeSettings from '@app1/components/ResponseVolumeSettings';
import { isNewTheme } from '@app1/components/uiTheme.js';
import { Icon } from '@app1/components/uiIcons.jsx';
import '@app1/components/drawing/DrawingToolbar.css';
import '@app1/components/drawing/DrawingSidebar.css';
import TradingPanel from './TradingPanel.jsx';
import OffscreenCapture from './OffscreenCapture.jsx';
import { openDecisionLevels } from './openDecision.js';
import { getJson, postJson } from './api.js';
import { linesFor, runPositionAction, subscribeBook, subscribeCancels } from './botBook.js';
import { dropLevels, knownLevels, restoreLevels } from '@app1/components/indicators/analysisLevels.js';
import { TAB, onDrawings, onSymbolsChanged, sendDrawings, symbolsChanged } from './tabs.js';
import TabsMenu from './TabsMenu.jsx';
import {
  SWING, RULE_KEYS, VISUAL_KEYS, attachSwing, feedSwing, frameName, notifySwingChanged, pick, profileRectIds,
  saveProfileRects, saveSwingRules, swingOf,
} from './swingServer.js';

/**
 * Grafico en vivo con el formato de la pestana principal de App 1: barra de dibujo, encabezado con los
 * marcos, un MiniChart por marco (cambiar de marco no recarga) y el panel de trading a la derecha.
 * Cada pestana (1 y 2) tiene sus indicadores; los dibujos son por moneda y se comparten al instante.
 */

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h'];
// Dias de velas por marco (el servidor tiene el mismo tope)
const DAYS = { '1m': 3, '5m': 10, '15m': 30, '1h': 120, '4h': 365 };
const TF_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000 };
const CLOSE_MAX_CANDLES = 200; // un trade más largo que esto en el marco a la vista se retrata en un marco mayor

// Imagen 10 velas después del cierre, como la de cierre de App 1 (12/11/2026): queda en localStorage hasta tomarla, así
// sobrevive a cerrar o reiniciar la suite. Una vencida hace más de 3 días, o con la apertura fuera de lo que carga el
// marco, se descarta; tres intentos sin imagen también
const AFTER_KEY = 'suite_after_shots';
const AFTER_CANDLES = 10;
const AFTER_MAX_LATE_MS = 3 * 86400000;
const AFTER_MAX_TRIES = 3;
const loadAfterShots = () => {
  try {
    const list = JSON.parse(localStorage.getItem(AFTER_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};
const saveAfterShots = (list) => {
  try {
    localStorage.setItem(AFTER_KEY, JSON.stringify(list));
  } catch {
    // Sin almacenamiento la imagen se toma solo si la página sigue abierta
  }
};

/**
 * Marco de la imagen de cierre: el que está a la vista si el trade cabe (hasta 200 velas y dentro de los días que
 * carga el marco, con aire antes de la apertura); si no, el primero mayor donde quepa. Nunca uno menor
 */
function closeFrame(start, end, preferred) {
  const from = Math.max(0, TIMEFRAMES.indexOf(preferred));
  for (let i = from; i < TIMEFRAMES.length; i++) {
    const tf = TIMEFRAMES[i];
    if ((end - start) / TF_MS[tf] <= CLOSE_MAX_CANDLES && end - start <= DAYS[tf] * 86400000 * 0.8) return tf;
  }
  return TIMEFRAMES[TIMEFRAMES.length - 1];
}

const DEFAULT_STATES = {
  'Volume Delta': true, 'Volume Profile': false, 'CVD': false, 'Open Interest': false, 'OI-Volume Confluence': false,
  'Order Flow': true, 'FVG': false, 'VP Periodic': false, 'Volumen de Respuesta': false, 'Liquidaciones': false,
  'Elementos OF': false, 'VWAP': false, 'Range Detection': false, 'Rejection Patterns': false, 'Double Top/Bottom': false,
  'Support & Resistance': false, 'S&R v2': false, 'Swing Detector': false,
};
const WITH_SETTINGS = new Set([
  'Volume Profile', 'Range Detection', 'Rejection Patterns', 'Support & Resistance', 'S&R v2', 'VWAP', 'Double Top/Bottom',
  'Swing Detector', 'OI-Volume Confluence', 'Order Flow', 'FVG', 'VP Periodic', 'Volumen de Respuesta', 'Liquidaciones', 'Elementos OF',
]);
const DEFAULT_VP_CONFIG = {
  mode: 'dynamic', rowCount: 100, valueAreaPercent: 70, hideWhenFixedRanges: false, showPOC: true, showVAH: true, showVAL: true,
};
const SETTINGS_KEY = `suite_chart_${TAB}`;

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

function initialTabStates(saved) {
  return Object.fromEntries(TIMEFRAMES.map(tf => {
    const own = saved.tabs?.[tf] || {};
    return [tf, {
      vpConfig: { ...DEFAULT_VP_CONFIG, ...(own.vpConfig || {}) },
      vpFixedRange: null,
      oiMode: own.oiMode || 'histogram',
    }];
  }));
}

/**
 * Indicadores encendidos: los mismos en los cinco marcos (13/11/2026). Antes cada marco tenía los suyos: se toman los
 * del marco que estaba a la vista
 */
function initialIndicators(saved) {
  const before = saved.tabs?.[saved.timeframe]?.indicatorStates || saved.tabs?.['15m']?.indicatorStates || {};
  return { ...DEFAULT_STATES, ...(saved.indicators || before) };
}

/**
 * Los indicadores de la pestaña 1, la del gráfico principal. Las pestañas 2 a 5 los usan, al día, hasta que se cambie
 * uno en ellas (13/11/2026, pedido del usuario: una moneda abierta desde la Watchlist de cualquier pestaña llega con
 * todos los indicadores del gráfico principal; antes una pestaña nueva empezaba con los de fábrica)
 */
const MAIN_SETTINGS_KEY = 'suite_chart_1';
function mainIndicators() {
  let main = {};
  try {
    main = JSON.parse(localStorage.getItem(MAIN_SETTINGS_KEY)) || {};
  } catch {
    main = {};
  }
  return {
    mode: main.indicatorMode === 'coin' ? 'coin' : 'shared',
    shared: initialIndicators(main),
    coin: main.coinIndicators && typeof main.coinIndicators === 'object' ? main.coinIndicators : {},
  };
}

const ModalBox = ({ onClose, width = 600, children }) => (
  <div
    onClick={onClose}
    style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 3000 }}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ backgroundColor: 'white', borderRadius: 8, maxWidth: width, maxHeight: '85vh', width: '90%', overflow: 'auto', position: 'relative', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}
    >
      <button
        onClick={onClose}
        title="Cerrar"
        style={{ position: 'sticky', top: 8, float: 'right', marginRight: 8, background: '#f44336', color: 'white', border: 'none', borderRadius: '50%', width: 32, height: 32, fontSize: 20, cursor: 'pointer', zIndex: 1 }}
      >
        ×
      </button>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  </div>
);

const dayText = (day) => (day ? day.split('-').reverse().slice(0, 2).join('/') : '—');

/** Puntos de estado en el encabezado: grabacion de trades, almacen y bot */
function StatusDots({ onOpenBot }) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let alive = true;
    const read = () => getJson('/api/suite/status').then(s => alive && setStatus(s)).catch(() => alive && setStatus(null));
    read();
    const timer = setInterval(read, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  if (!status) return <span className="suite-dots"><span className="suite-dot bad" />Servidor sin respuesta</span>;
  const rec = status.recorder || {};
  const btc = status.store?.BTCUSDT || {};
  const recording = rec.records || rec.other_process_records || status.local_tape?.running;
  const bot = status.bot || {};
  return (
    <span className="suite-dots">
      <span
        title={`Grabación de trades: ${rec.records ? `esta app (${rec.symbols} monedas)` : rec.other_process_records || status.local_tape?.running ? 'el backend 11000' : 'apagada'}\n`
          + `Almacén oficial BTC hasta ${dayText(btc.official_last)} · días en vivo: ${btc.live_days?.length ? btc.live_days.map(dayText).join(', ') : 'ninguno'}`}
      >
        <span className={`suite-dot ${recording ? 'ok' : 'bad'}`} />Order flow
      </span>
      <span title="Estado del bot" onClick={onOpenBot} style={{ cursor: 'pointer' }}>
        <span className={`suite-dot ${bot.online ? (bot.trading_paused ? 'warn' : 'ok') : 'bad'}`} />
        Bot {bot.online ? `${bot.mode || ''}${bot.trading_paused ? ' · pausa' : ''}` : 'sin respuesta'}
      </span>
    </span>
  );
}

export default function ChartView({ active = true, onOpenBot, onOpenTheme, onOpenWatchlist = null, onModule = null, focusTrade = null, focusSymbol = null }) {
  const saved = useMemo(loadSettings, []);
  const chartRefs = useRef({});
  const [symbols, setSymbols] = useState([saved.symbol || 'BTCUSDT']);
  const [symbol, setSymbol] = useState(saved.symbol || 'BTCUSDT');
  const [activeTimeframe, setActiveTimeframe] = useState(TIMEFRAMES.includes(saved.timeframe) ? saved.timeframe : '15m');
  const [tabStates, setTabStates] = useState(() => initialTabStates(saved));
  // Los mismos indicadores para todas las monedas, o los propios de cada una (los que no tienen, usan los comunes)
  const [indicatorMode, setIndicatorMode] = useState(saved.indicatorMode === 'coin' ? 'coin' : 'shared');
  const [sharedStates, setSharedStates] = useState(() => initialIndicators(saved));
  const [coinStates, setCoinStates] = useState(() => (saved.coinIndicators && typeof saved.coinIndicators === 'object' ? saved.coinIndicators : {}));
  // Pestañas 2 a 5: los de la pestaña 1, al día, hasta que se cambie uno aquí (entonces son propios: ownIndicators)
  const [ownIndicators, setOwnIndicators] = useState(TAB === 1 || saved.indicatorsCustom === true);
  const [inherited, setInherited] = useState(() => (TAB === 1 ? null : mainIndicators()));
  useEffect(() => {
    if (ownIndicators) return undefined;
    const onStorage = (e) => {
      if (e.key !== MAIN_SETTINGS_KEY) return;
      const next = mainIndicators();
      // La pestaña 1 guarda también al cambiar de moneda o de marco: si los indicadores no cambiaron, nada se toca
      setInherited(prev => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [ownIndicators]);
  const view = useMemo(
    () => (ownIndicators ? { mode: indicatorMode, shared: sharedStates, coin: coinStates } : inherited),
    [ownIndicators, indicatorMode, sharedStates, coinStates, inherited],
  );
  const statesFor = useCallback(
    (sym) => (view.mode === 'coin' && view.coin[sym] ? { ...DEFAULT_STATES, ...view.coin[sym] } : view.shared),
    [view],
  );
  const currentStates = useMemo(() => statesFor(symbol), [statesFor, symbol]);
  const currentStatesRef = useRef(currentStates);
  currentStatesRef.current = currentStates;
  const [showList, setShowList] = useState(false);
  const [settingsFor, setSettingsFor] = useState(null);
  const [currentTool, setCurrentTool] = useState('select');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [showTrading, setShowTrading] = useState(saved.showTrading !== false);
  const [adding, setAdding] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [addError, setAddError] = useState('');
  const [shapes, setShapes] = useState([]);
  const [rejectionConfig, setRejectionConfig] = useState(null);
  const [positionNotice, setPositionNotice] = useState(null);
  const listRef = useRef(null);
  // Swing del servidor (paso 5, parte B): el indicador dibuja lo que calcula el servidor (swingServer.js)
  const [swingVisual, setSwingVisual] = useState(() => saved.swingVisual || {});
  const [swingSave, setSwingSave] = useState(null);   // { saving } | { savedAt } | { error }
  const swingRef = useRef({});             // marco -> { ind, data, version, last, pending, tried }
  const swingVersionRef = useRef(0);       // sube con un cambio de reglas, dibujos o VP Fixed: los marcos vuelven a pedir
  const swingSaveTimer = useRef(null);
  const swingSavingRef = useRef(false);    // mientras se guarda, lo que llega del servidor no pisa el modal
  const swingVisualRef = useRef(swingVisual);
  swingVisualRef.current = swingVisual;

  // Posiciones y órdenes reales sobre el gráfico (paso 4): el getter es estable y lee la moneda a la vista
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;
  const activeTfRef = useRef(activeTimeframe);
  activeTfRef.current = activeTimeframe;
  const getPositionLines = useCallback(() => linesFor(symbolRef.current), []);
  // Journal (paso 4): una imagen del gráfico a la vista, subida al servidor de la suite (mismo contrato que App 1)
  const captureFor = useCallback(async (name, options = {}) => {
    const tf = activeTfRef.current;
    try {
      const shot = await chartRefs.current[tf]?.captureScreenshot?.('journal', name, options);
      return { image: shot?.screenshotPath || null, frame: tf };
    } catch {
      return { image: null, frame: tf }; // gráfico oculto o sin velas: el contexto va sin imagen
    }
  }, []);
  const saveContext = useCallback((context) => postJson('/api/journal/context', context)
    .catch(e => console.warn('[journal] contexto no guardado:', e.message)), []);

  // Al enviar una orden desde el panel: la imagen de la decisión (con contexto) sale ya, con lo elegido; lo elegido
  // sale de la lista y queda en el journal solo cuando se sabe qué pasó con la orden (settle). Antes salía al enviar:
  // si el bot rechazaba la orden, o se cancelaba la Limit para cambiarla, la orden que sí abría no llevaba nada (12/11/2026)
  const handleDecision = useCallback(({ symbol: sym, side, note, order }) => {
    const at = Date.now();
    const levels = knownLevels(sym, Infinity);
    const shot = sym === symbolRef.current
      ? captureFor(`decision-${at}`, { context: true, items: levels })
      : Promise.resolve({ image: null, frame: null });
    return shot.then(({ image, frame }) => ({
      // outcome: 'placed' (quedó en Bybit), 'unknown' (sin respuesta) o 'rejected' (no salió). ids: la orden de Bybit
      settle: (outcome, ids = {}) => {
        if (outcome === 'rejected') return; // lo elegido sigue en la lista para la orden corregida
        // En Bybit: como en App 1, lo elegido pasa a este trade y la lista queda para el siguiente. Sin respuesta, la
        // decisión se guarda con una copia y la lista sigue: el reintento lo lleva
        if (outcome === 'placed') dropLevels(sym, levels);
        saveContext({
          kind: 'decision', symbol: sym, side, at, image, frame, note, levels, order, outcome,
          ...(ids.order_id ? { order_id: String(ids.order_id) } : {}),
          ...(ids.order_link_id ? { order_link_id: String(ids.order_link_id) } : {}),
        });
      },
    }));
  }, [captureFor, saveContext]);

  // Una Limit del panel cancelada sin llenarse: lo elegido para ella vuelve a la lista, para la orden que la reemplace
  useEffect(() => subscribeCancels(async (line) => {
    if (!line?.orderId && !line?.orderLinkId) return;
    const query = line.orderId ? `order_id=${encodeURIComponent(line.orderId)}` : `order_link_id=${encodeURIComponent(line.orderLinkId)}`;
    try {
      const { decision } = await getJson(`/api/journal/decision?${query}`);
      const back = restoreLevels(line.symbol, decision?.levels || []);
      if (back) {
        const notice = { ok: true, message: `Lo elegido para esa orden volvió a la lista (${back}): lo lleva la orden que la reemplace` };
        setPositionNotice(notice);
        setTimeout(() => setPositionNotice(n => (n === notice ? null : n)), 8000);
      }
    } catch {
      // Sin decisión guardada de esa orden (de una alerta o de otra app): no hay nada que devolver
    }
  }), []);

  // Imágenes de apertura y cierre de una moneda que no está a la vista, o con el gráfico oculto (módulo del bot):
  // su gráfico se arma fuera de la pantalla (OffscreenCapture), una imagen a la vez (12/11/2026, pedido del usuario)
  const [offscreenJob, setOffscreenJob] = useState(null);
  // Los indicadores de la moneda de la imagen: el mismo objeto mientras no cambien, así su gráfico no los vuelve a aplicar
  const offscreenStates = useMemo(() => (offscreenJob ? statesFor(offscreenJob.symbol) : null), [offscreenJob, statesFor]);
  const offscreenQueueRef = useRef([]);
  const offscreenBusyRef = useRef(false);
  const chartsBoxRef = useRef(null);
  const chartSizeRef = useRef({ width: 1200, height: 720 }); // el último tamaño del gráfico a la vista
  const chartSize = useCallback(() => {
    const r = chartsBoxRef.current?.getBoundingClientRect();
    if (r && r.width > 300 && r.height > 200) chartSizeRef.current = { width: Math.round(r.width), height: Math.round(r.height) };
    return chartSizeRef.current;
  }, []);
  const pumpOffscreen = useCallback(() => {
    if (offscreenBusyRef.current) return;
    const next = offscreenQueueRef.current.shift();
    if (!next) return;
    offscreenBusyRef.current = true;
    setOffscreenJob(next);
  }, []);
  const afterQueuedRef = useRef(new Set()); // imágenes "después" ya en la cola, para no encolarlas dos veces
  const finishOffscreen = useCallback((job, image) => {
    if (image) {
      saveContext({ kind: job.kind, symbol: job.symbol, side: job.side, at: job.at, image, frame: job.tf,
                    ...(job.until ? { until: job.until } : {}) });
    }
    if (job.kind === 'after') {
      // Tomada, sale de la lista; sin imagen, se reintenta en la próxima revisión hasta AFTER_MAX_TRIES
      afterQueuedRef.current.delete(job.afterId);
      const list = loadAfterShots()
        .map(entry => (entry.id === job.afterId ? { ...entry, tries: (entry.tries || 0) + 1 } : entry))
        .filter(entry => entry.id !== job.afterId || (!image && entry.tries < AFTER_MAX_TRIES));
      saveAfterShots(list);
    }
    offscreenBusyRef.current = false;
    setOffscreenJob(null);
    setTimeout(pumpOffscreen, 300);
  }, [saveContext, pumpOffscreen]);

  // Las imágenes "después" vencidas se toman fuera de la pantalla: al abrir la página y cada 30 s. Solo la pestaña 1
  useEffect(() => {
    if (TAB !== 1) return undefined;
    const review = () => {
      const now = Date.now();
      const list = loadAfterShots();
      const kept = list.filter(entry => now - entry.dueAt <= AFTER_MAX_LATE_MS
        && now - entry.start <= (DAYS[entry.tf] || 0) * 86400000 * 0.95);
      if (kept.length !== list.length) saveAfterShots(kept);
      for (const entry of kept) {
        if (entry.dueAt > now || afterQueuedRef.current.has(entry.id)) continue;
        afterQueuedRef.current.add(entry.id);
        offscreenQueueRef.current.push({
          id: entry.id, afterId: entry.id, kind: 'after', symbol: entry.symbol, side: entry.side, at: entry.closedAt, until: entry.dueAt,
          tf: entry.tf, days: DAYS[entry.tf], size: chartSize(), box: entry.box,
          options: { showFrom: entry.start, showUntil: entry.dueAt, items: entry.items || [] },
        });
      }
      pumpOffscreen();
    };
    review();
    const timer = setInterval(review, 30000);
    return () => clearInterval(timer);
  }, [pumpOffscreen, chartSize]);

  // Imagen de cierre como en App 1 (12/11/2026, pedido del usuario): encuadrada desde la apertura del trade, con su
  // caja de entrada, SL y TP hasta el cierre y lo elegido para él, en un marco donde el trade quepa. La caja lleva el
  // SL y el TP vigentes al cerrar: si se movieron, los nuevos (el usuario lo vio con ARB: salían los iniciales)
  const captureBoxRef = useRef(null); // { symbol, box }: la caja del trade que se retrata, solo mientras se dibuja la imagen
  const closePlan = useCallback(async (p, closedAt) => {
    let trade = null;
    try {
      const { trades } = await getJson(`/api/bot/journal?days=30&symbol=${encodeURIComponent(p.symbol)}`);
      const entry = Number(p.entryPrice);
      // El trade del journal del bot de esa posición: misma moneda y lado, abierto antes y con la misma entrada
      trade = (trades || [])
        .filter(t => t.symbol === p.symbol && t.side === p.side && t.opened_at && t.opened_at <= closedAt
          && (!(entry > 0) || !(t.entry > 0) || Math.abs(t.entry - entry) / entry < 0.005))
        .sort((a, b) => b.opened_at - a.opened_at)[0] || null;
    } catch {
      // Sin el journal del bot la imagen sale como antes: la vista a esa hora
    }
    if (!trade) return { tf: activeTfRef.current, start: null, box: null, items: [] };
    const start = trade.opened_at;
    const positive = (v) => (Number(v) > 0 ? Number(v) : null);
    const box = {
      side: p.side === 'Buy' ? 'long' : 'short', entry: positive(trade.entry) ?? positive(p.entryPrice),
      stop: positive(trade.stop_loss) ?? positive(p.stopLoss) ?? positive(trade.initial_stop_loss),
      target: positive(trade.take_profit) ?? positive(p.takeProfit) ?? positive(trade.initial_take_profit),
      start, end: closedAt,
    };
    return { tf: closeFrame(start, closedAt, activeTfRef.current), start, box, items: trade.decision?.levels || [] };
  }, []);

  // Imagen de apertura con lo elegido para ese trade, como en App 1 (13/11/2026): los niveles de su decisión
  // (openDecision.js). Un trade sin decisión (de una alerta) no dibuja nada elegido
  const openPlan = useCallback(async (p, openedAt) => {
    const items = await openDecisionLevels(p, openedAt, {
      fetchTrades: async (sym) => (await getJson(`/api/bot/journal?days=1&symbol=${encodeURIComponent(sym)}`)).trades,
    });
    return { tf: activeTfRef.current, start: null, box: null, items };
  }, []);

  useEffect(() => {
    let last = '';
    let known = null; // { account, map } con las posiciones de todas las monedas en la lectura anterior
    return subscribeBook((book) => {
      const key = JSON.stringify(linesFor(symbolRef.current));
      if (key !== last) {
        last = key;
        chartRefs.current[activeTfRef.current]?.forceRedraw?.(); // sin esperar el próximo precio
      }
      // Imágenes de apertura y cierre para el journal, de todas las monedas. Solo la pestaña 1: la 2.ª las repetiría
      if (book.error || !book.at) return;
      const account = book.account?.id ?? null;
      const now = new Map(book.positions.filter(p => Number(p.size) > 0).map(p => [`${p.symbol}:${p.positionIdx ?? 0}:${p.side}`, p]));
      // Con otra cuenta las posiciones son otras: no se abrió ni se cerró nada
      if (TAB === 1 && known && known.account === account) {
        const moment = async (kind, p) => {
          const at = Date.now();
          // Apertura: la vista a esa hora con contexto y lo elegido para el trade (openPlan). Cierre: el trade completo
          // con su caja (closePlan)
          const plan = kind === 'close' ? await closePlan(p, at) : await openPlan(p, at);
          const tf = plan.tf;
          const options = kind === 'open' ? { context: true, items: plan.items } : { showFrom: plan.start, items: plan.items };
          // Y 10 velas después, la misma imagen con lo que hizo el precio tras el cierre (como la de cierre de App 1)
          if (kind === 'close' && plan.start) {
            saveAfterShots([...loadAfterShots(), {
              id: `after-${p.symbol}-${p.side}-${at}`, symbol: p.symbol, side: p.side, closedAt: at, dueAt: at + AFTER_CANDLES * TF_MS[tf],
              tf, start: plan.start, box: plan.box, items: plan.items, tries: 0,
            }]);
          }
          if (p.symbol === symbolRef.current && tf === activeTfRef.current && chartRefs.current[tf]?.isShown?.()) {
            setTimeout(async () => {
              // La caja solo existe mientras se dibuja la imagen: la vista de quien opera no la muestra
              captureBoxRef.current = plan.box ? { symbol: p.symbol, box: plan.box } : null;
              const pending = captureFor(`${kind}-${at}`, options);
              captureBoxRef.current = null;
              const { image, frame } = await pending;
              if (image) saveContext({ kind, symbol: p.symbol, side: p.side, at, image, frame });
            }, Math.max(0, 1500 - (Date.now() - at))); // que el gráfico dibuje antes la línea nueva (o la quite)
          } else {
            offscreenQueueRef.current.push({ id: `${kind}-${p.symbol}-${p.side}-${at}`, kind, symbol: p.symbol, side: p.side, at, tf,
                                             days: DAYS[tf], size: chartSize(), options, box: plan.box });
            pumpOffscreen();
          }
        };
        for (const [k, p] of now) if (!known.map.has(k)) moment('open', p);
        for (const [k, p] of known.map) if (!now.has(k)) moment('close', p);
      }
      known = { account, map: now };
    });
  }, [captureFor, saveContext, pumpOffscreen, chartSize, closePlan, openPlan]);

  // Análisis post-trade (13/11/2026, pedido del usuario): desde "Ver en el gráfico", dibujar sobre el trade (por ejemplo
  // sus conclusiones) y guardar una imagen en el journal. Lo dibujado va a una capa del trade (data/journal/analysis), que
  // los gráficos muestran en lugar de los dibujos de la moneda mientras dura el análisis (drawingsSource de MiniChart):
  // no pasa al panel de trading, al Swing ni a las otras pestañas, y se puede seguir editando otro día. Lo elegido a la
  // vista es lo de ese trade, con los números de su decisión (chosenItems)
  const [analysis, setAnalysis] = useState(null); // el trade que se analiza
  const analysisRef = useRef(null);
  analysisRef.current = analysis;
  const [analysisNote, setAnalysisNote] = useState('');
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const analysisSource = useMemo(() => {
    if (!analysis) return null;
    const path = `/api/journal/analysis/${encodeURIComponent(analysis.trade_id)}/drawings`;
    return {
      key: `analysis:${analysis.trade_id}`,
      load: async () => (await getJson(path)).shapes || [],
      save: (shapes) => postJson(path, { shapes }),
    };
  }, [analysis]);
  const analysisItems = useMemo(() => (analysis ? (analysis.decision?.levels || []) : null), [analysis]);
  // El análisis es de la moneda del trade: otra moneda lo termina
  useEffect(() => {
    if (analysisRef.current && analysisRef.current.symbol !== symbol) setAnalysis(null);
  }, [symbol]);

  // "Ver en el gráfico" desde el journal: su moneda, la vista en su apertura y su caja con entrada, SL y TP iniciales
  const focusBoxRef = useRef(null);
  const [focusedTrade, setFocusedTrade] = useState(null);
  const getTradeBoxes = useCallback(() => {
    const boxes = [];
    for (const shown of [focusBoxRef.current, captureBoxRef.current]) {
      if (shown && shown.symbol === symbolRef.current) boxes.push(shown.box);
    }
    return boxes;
  }, []);
  useEffect(() => {
    if (!focusTrade) return undefined;
    const t = focusTrade;
    const start = t.opened_at || t.closed_at;
    if (!start) return undefined;
    setAnalysis(null); // otro trade (o el mismo, pedido de nuevo): el análisis anterior termina
    // Cerrado: con el SL y el TP vigentes al cerrar, como su imagen de cierre. Abierto: con los iniciales (el plan);
    // los vigentes ya están en las líneas de la posición
    const closedTrade = t.status === 'closed';
    focusBoxRef.current = {
      symbol: t.symbol,
      box: { side: t.side === 'Buy' ? 'long' : 'short', entry: t.entry,
             stop: closedTrade ? (t.stop_loss ?? t.initial_stop_loss) : (t.initial_stop_loss ?? t.stop_loss),
             target: closedTrade ? (t.take_profit ?? t.initial_take_profit) : (t.initial_take_profit ?? t.take_profit),
             start, end: t.closed_at || Date.now() },
    };
    setFocusedTrade(t);
    if (t.symbol !== symbolRef.current) setSymbol(t.symbol);
    // Los gráficos de otra moneda se montan de nuevo: se espera a que tengan velas
    const focus = () => {
      const chart = chartRefs.current[activeTfRef.current];
      chart?.focusOn?.(start, t.entry);
      chart?.forceRedraw?.();
    };
    const timers = t.symbol !== symbolRef.current ? [setTimeout(focus, 2500), setTimeout(focus, 6000)] : [setTimeout(focus, 300)];
    return () => timers.forEach(clearTimeout);
  }, [focusTrade]);
  const clearFocusedTrade = () => {
    focusBoxRef.current = null;
    setFocusedTrade(null);
    setAnalysis(null);
    chartRefs.current[activeTfRef.current]?.forceRedraw?.();
  };
  // La imagen del análisis: lo que se ve en el marco a la vista (caja del trade, lo elegido y lo dibujado), con la
  // conclusión escrita. Se une al trade por su número, a cualquier hora
  const saveAnalysisImage = async () => {
    const t = analysisRef.current;
    if (!t || analysisBusy) return;
    setAnalysisBusy(true);
    let result;
    try {
      const shot = await captureFor(`analysis-${Date.now()}`);
      if (!shot.image) throw new Error('no se pudo tomar la imagen del gráfico');
      const note = analysisNote.trim();
      await postJson('/api/journal/context', {
        kind: 'analysis', symbol: t.symbol, side: t.side, at: Date.now(), trade_id: t.trade_id, image: shot.image, frame: shot.frame,
        ...(note ? { note } : {}),
      });
      setAnalysisNote('');
      result = { ok: true, message: `Imagen del análisis guardada en el journal del trade (${shot.frame})` };
    } catch (e) {
      result = { ok: false, message: `La imagen del análisis no se guardó: ${e.message}` };
    } finally {
      setAnalysisBusy(false);
    }
    setPositionNotice(result);
    setTimeout(() => setPositionNotice(n => (n === result ? null : n)), result.ok ? 5000 : 12000);
  };
  const handlePositionAction = useCallback(async (action) => {
    const result = await runPositionAction(action);
    chartRefs.current[activeTfRef.current]?.forceRedraw?.();
    if (result) {
      setPositionNotice(result);
      setTimeout(() => setPositionNotice(n => (n === result ? null : n)), result.ok ? 5000 : 12000);
    }
  }, []);

  // Watchlist (paso 5, parte C): un clic en una moneda la abre aquí, en el marco de la cuadrícula
  useEffect(() => {
    if (!focusSymbol?.symbol) return;
    if (focusSymbol.symbol !== symbolRef.current) setSymbol(focusSymbol.symbol);
    if (TIMEFRAMES.includes(focusSymbol.tf)) setActiveTimeframe(focusSymbol.tf);
  }, [focusSymbol]);

  const readSymbols = useCallback(() => getJson('/api/suite/symbols').then(d => setSymbols(d.symbols)).catch(() => {}), []);
  useEffect(() => onSymbolsChanged(list => setSymbols(list)), []);
  useEffect(() => { readSymbols(); }, [readSymbols]);

  useEffect(() => {
    try {
      const tabs = Object.fromEntries(TIMEFRAMES.map(tf => [tf, { vpConfig: tabStates[tf].vpConfig, oiMode: tabStates[tf].oiMode }]));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        symbol, timeframe: activeTimeframe, tabs, showTrading, swingVisual,
        indicators: sharedStates, indicatorMode, coinIndicators: coinStates,
        ...(TAB > 1 ? { indicatorsCustom: ownIndicators } : {}),
      }));
    } catch {
      // Sin almacenamiento la eleccion dura hasta cerrar la pagina
    }
  }, [symbol, activeTimeframe, tabStates, showTrading, swingVisual, sharedStates, indicatorMode, coinStates, ownIndicators]);

  // Solo en desarrollo: acceso a los graficos desde la consola para revisarlos
  useEffect(() => {
    if (import.meta.env.DEV) {
      window.__suiteCharts = chartRefs;
      window.__suiteSwing = swingRef; // lo último que dio el servidor por marco
    }
  }, []);

  // Al volver al modulo o cambiar de marco el grafico se redibuja con su tamano real
  useEffect(() => {
    if (active) setTimeout(() => chartRefs.current[activeTimeframe]?.forceRedraw?.(), 50);
  }, [active, activeTimeframe, showTrading]);

  // Double Top/Bottom y Rejection solo piden sus patrones al activarse: en vivo se vuelven a pedir cada 5 minutos
  useEffect(() => {
    const timer = setInterval(() => {
      const tf = activeTimeframe;
      const current = chartRefs.current[tf]?.getIndicatorManager?.();
      if (!current) return;
      ['Double Top/Bottom', 'Rejection Patterns'].forEach(name => {
        const ind = current.indicators?.find(i => i.name === name);
        if (ind?.enabled && typeof ind.fetchData === 'function') {
          Promise.resolve(ind.fetchData()).then(() => chartRefs.current[tf]?.forceRedraw?.()).catch(() => {});
        }
      });
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [activeTimeframe, symbol]);

  // Cerrar la lista de indicadores con un clic afuera
  useEffect(() => {
    if (!showList) return undefined;
    const close = (e) => { if (listRef.current && !listRef.current.contains(e.target)) setShowList(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showList]);

  // Dibujos: los mismos en los cinco marcos y en la otra pestana, si mira la misma moneda. Durante un análisis
  // post-trade los gráficos muestran la capa del trade: los de la moneda (de otra pestaña) solo van al panel y al Swing
  const loadEverywhere = useCallback((list, except) => {
    if (!analysisRef.current) {
      TIMEFRAMES.forEach(tf => {
        if (tf !== except) chartRefs.current[tf]?.loadDrawings?.(list, true);
      });
    }
    setShapes(list);
    // Los rectángulos son las zonas del filtro VWAP del Swing: el servidor ya tiene los dibujos guardados
    swingVersionRef.current += 1;
    notifySwingChanged(symbolRef.current);
  }, []);
  const handleDrawingsChange = useCallback((list, sourceInterval) => {
    if (analysisRef.current) {
      // Lo dibujado en el análisis: ya quedó en la capa del trade; solo pasa a los otros marcos
      TIMEFRAMES.forEach(tf => {
        if (tf !== sourceInterval) chartRefs.current[tf]?.loadDrawings?.(list, true);
      });
      return;
    }
    loadEverywhere(list, sourceInterval);
    sendDrawings(symbol, list);
  }, [symbol, loadEverywhere]);
  useEffect(() => onDrawings((sym, list) => { if (sym === symbol) loadEverywhere(list); }), [symbol, loadEverywhere]);
  useEffect(() => {
    setShapes([]);
    getJson(`/api/drawings/${symbol}`).then(d => setShapes(d.shapes || [])).catch(() => {});
  }, [symbol]);

  const managerOf = (tf) => chartRefs.current[tf]?.getIndicatorManager?.() || null;
  const manager = () => managerOf(activeTimeframe);
  const applyToAll = (change) => {
    TIMEFRAMES.forEach(tf => {
      const current = managerOf(tf);
      if (!current) return;
      change(current);
      chartRefs.current[tf]?.forceRedraw?.();
    });
  };
  const redraw = () => chartRefs.current[activeTimeframe]?.forceRedraw?.();
  const setTab = (tf, change) => setTabStates(prev => ({ ...prev, [tf]: { ...prev[tf], ...change(prev[tf]) } }));
  // Un indicador vale para los cinco marcos: de todas las monedas, o solo de esta si cada una tiene los suyos. En las
  // pestañas 2 a 5, el primer cambio les da sus propios indicadores, a partir de los de la pestaña 1
  const takeOwnIndicators = () => {
    if (ownIndicators) return view;
    setOwnIndicators(true);
    setIndicatorMode(inherited.mode);
    setSharedStates(inherited.shared);
    setCoinStates(inherited.coin);
    return inherited;
  };
  const toggle = (name, value) => {
    const base = takeOwnIndicators();
    if (base.mode === 'coin') setCoinStates(prev => ({ ...prev, [symbol]: { ...(prev[symbol] || base.shared), [name]: value } }));
    else setSharedStates(prev => ({ ...prev, [name]: value }));
  };
  const changeIndicatorMode = (mode) => {
    takeOwnIndicators();
    setIndicatorMode(mode);
  };
  const followMainIndicators = () => {
    setInherited(mainIndicators());
    setOwnIndicators(false);
  };
  const closeSettings = () => setSettingsFor(null);
  const noop = useCallback(() => {}, []);
  const noTrades = useCallback(() => [], []);

  // Swing del servidor (paso 5, parte B): cada marco con el Swing encendido pide sus señales al servidor al cerrar su
  // vela, y otra vez si cambian las reglas, los dibujos o los VP Fixed. Mientras no llegan, el indicador no calcula
  // por su cuenta: lo haría con la vela en curso
  useEffect(() => {
    let alive = true;
    let busy = false;
    let sentRects = null;
    swingRef.current = {};
    const round = async () => {
      if (busy) return;
      busy = true;
      try {
        TIMEFRAMES.forEach(tf => {
          // Gráfico recién armado: lo último que dio el servidor, o nada mientras llega
          const st = swingRef.current[tf] || (swingRef.current[tf] = {});
          attachSwing(st, swingOf(managerOf(tf)), swingVisualRef.current);
        });
        const frames = TIMEFRAMES.filter(tf => currentStatesRef.current?.[SWING] && swingRef.current[tf]?.ind);
        if (!frames.length) return;
        // Los rectángulos de un VP Fixed no cuentan para el filtro VWAP: el servidor los sabe por la página
        const ids = profileRectIds(managerOf(frames[0]));
        if (ids.join('|') !== sentRects) {
          try {
            await saveProfileRects(symbol, ids);
            sentRects = ids.join('|');
            swingVersionRef.current += 1;
          } catch {
            // Se reintenta en la vuelta siguiente; mientras, el servidor usa la lista anterior
          }
        }
        for (const tf of frames) {
          if (!alive) return;
          const drew = await feedSwing(swingRef.current[tf], {
            symbol, tf, tfMs: TF_MS[tf], version: swingVersionRef.current, visual: swingVisualRef.current,
            keepRules: swingSavingRef.current, isAlive: () => alive,
          });
          if (drew) chartRefs.current[tf]?.forceRedraw?.();
        }
      } finally {
        busy = false;
      }
    };
    round();
    const timer = setInterval(round, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [symbol]);

  // Modal del Swing: las flechas quedan en la pestaña y las reglas en el servidor, para la moneda. Se guardan medio
  // segundo después del último cambio, así un deslizador no manda un pedido por paso
  const changeSwing = (next) => {
    const rules = pick(next, RULE_KEYS);
    const before = pick(swingOf(manager())?.getConfig?.(), RULE_KEYS);
    setSwingVisual(prev => ({ ...prev, ...pick(next, VISUAL_KEYS) }));
    applyToAll(m => swingOf(m)?.updateConfig(next));
    // Solo las flechas: nada que guardar en el servidor
    if (JSON.stringify(rules) === JSON.stringify(before) && !swingSavingRef.current) return;
    clearTimeout(swingSaveTimer.current);
    const sym = symbol;
    swingSavingRef.current = true;
    setSwingSave({ saving: true });
    swingSaveTimer.current = setTimeout(async () => {
      try {
        await saveSwingRules(sym, rules);
        swingVersionRef.current += 1;
        notifySwingChanged(sym);   // la Watchlist vuelve a pedir las señales de esta moneda
        setSwingSave({ savedAt: Date.now() });
      } catch (e) {
        setSwingSave({ error: e.message });
      } finally {
        swingSavingRef.current = false;
      }
    }, 500);
  };

  const openSettings = (name) => {
    if (!manager()) {
      alert('El gráfico todavía está cargando. Espera unos segundos e inténtalo de nuevo.');
      return;
    }
    setShowList(false);
    if (name === SWING) setSwingSave(null);
    setSettingsFor(name);
  };

  const addSymbol = async () => {
    const s = newSymbol.trim().toUpperCase();
    if (!s) return;
    setAddError('');
    try {
      const d = await postJson('/api/suite/symbols', { symbol: s });
      setSymbols(d.symbols);
      symbolsChanged(d.symbols); // la Watchlist y las otras pestañas la muestran al instante
      setSymbol(s);
      setAdding(false);
      setNewSymbol('');
    } catch (e) {
      setAddError(e.message);
    }
  };

  const renderSettings = () => {
    const current = settingsFor ? manager() : null;
    if (!current) return null;
    const state = tabStates[activeTimeframe];
    switch (settingsFor) {
      case 'Volume Profile':
        return (
          <ModalBox onClose={closeSettings}>
            <h3 style={{ marginTop: 0 }}>Volume Profile ({activeTimeframe})</h3>
            <VolumeProfileSettings
              config={state.vpConfig}
              onConfigChange={(next) => setTab(activeTimeframe, s => ({ vpConfig: { ...s.vpConfig, ...next } }))}
              onFixedRangeChange={(start, end) => setTab(activeTimeframe, () => ({ vpFixedRange: { start, end, applyToAll: false, symbol } }))}
              applyToAll={false}
              onApplyToAllChange={noop}
              currentSymbol={symbol}
            />
          </ModalBox>
        );
      case 'Range Detection':
        return <RangeDetectionSettings symbol={symbol} indicatorManager={current} candles={null} onClose={closeSettings} />;
      case 'Rejection Patterns':
        return (
          <RejectionPatternSettings
            symbol={symbol}
            indicatorManager={current}
            onConfigChange={(config) => { setRejectionConfig(config); applyToAll(m => m.updateRejectionPatternConfig(config)); }}
            onShowModeChange={(mode) => applyToAll(m => m.getRejectionPatternIndicator()?.setShowMode(mode))}
            onClose={closeSettings}
            initialConfig={rejectionConfig}
          />
        );
      case 'Support & Resistance':
        return <SupportResistanceSettings symbol={symbol} indicatorManager={current} onClose={closeSettings} />;
      case 'S&R v2':
        return (
          <SupportResistance2Settings
            symbol={symbol}
            indicatorManager={current}
            onConfigChange={config => applyToAll(m => m.supportResistance2Indicator?.updateConfig(config))}
            onClose={closeSettings}
          />
        );
      case 'VWAP':
        return (
          <ModalBox onClose={closeSettings} width={900}>
            <VWAPSettings
              config={current.getIndicatorConfig('VWAP') || {}}
              onConfigChange={async (newConfig) => {
                await current.applyConfig('VWAP', newConfig);
                const vwap = current.indicators.find(ind => ind.name === 'VWAP');
                if (vwap) {
                  vwap._lastCalculatedLength = 0;
                  vwap._calculationValid = false;
                }
                redraw();
              }}
              currentSymbol={symbol}
              interval={activeTimeframe}
              onClose={closeSettings}
            />
          </ModalBox>
        );
      case 'Double Top/Bottom':
        return (
          <ModalBox onClose={closeSettings} width={900}>
            <DoubleTopBottomSettings
              symbol={symbol}
              initialConfig={current.getIndicatorConfig('Double Top/Bottom')}
              onConfigChange={async (newConfig) => { await current.applyConfig('Double Top/Bottom', newConfig); redraw(); }}
              onClose={closeSettings}
            />
          </ModalBox>
        );
      case 'Swing Detector': {
        const info = swingRef.current[activeTimeframe]?.data;
        return (
          <ModalBox onClose={closeSettings} width={700}>
            <div className="suite-result" style={{ marginTop: 0, marginBottom: 10 }}>
              Las señales las calcula el servidor de la suite con las velas cerradas: lo que ves es lo que detecta. Los
              cambios se guardan en el servidor para {symbol}. No envía alertas.
              {info && (
                <div style={{ marginTop: 4 }}>
                  {info.detected_live
                    ? `El servidor vigila ${symbol} en vivo en ${frameName(info.detection_interval)} y anota cada señal.`
                    : `El servidor vigila en vivo en ${frameName(info.detection_interval)}: en este marco (${activeTimeframe}) las señales son solo para ver.`}
                </div>
              )}
              <div style={{ marginTop: 4 }}>
                Su filtro VWAP usa el VWAP de sesión con las bandas de fábrica y actúa aunque el indicador VWAP esté apagado.
              </div>
            </div>
            {swingSave?.saving && <div className="suite-result" style={{ marginTop: 0, marginBottom: 10 }}>Guardando…</div>}
            {swingSave?.savedAt && <div className="suite-result ok" style={{ marginTop: 0, marginBottom: 10 }}>Guardado en el servidor.</div>}
            {swingSave?.error && <div className="suite-result bad" style={{ marginTop: 0, marginBottom: 10 }}>No se guardó: {swingSave.error}</div>}
            <SwingDetectorSettings
              symbol={symbol}
              config={current.getIndicatorConfig('Swing Detector')}
              onConfigChange={changeSwing}
              onClose={closeSettings}
            />
          </ModalBox>
        );
      }
      case 'OI-Volume Confluence':
        return (
          <ModalBox onClose={closeSettings} width={700}>
            <OIVolumeConfluenceSettings
              config={current.getIndicatorConfig('OI-Volume Confluence') || {}}
              onConfigChange={async (newConfig) => { await current.applyConfig('OI-Volume Confluence', newConfig); redraw(); }}
              currentSymbol={symbol}
              onClose={closeSettings}
            />
          </ModalBox>
        );
      case 'Order Flow':
        return (
          <OrderFlowSettings
            symbol={symbol}
            indicator={current.getOrderFlowIndicator()}
            activeTimeframe={activeTimeframe}
            onApply={(settings) => applyToAll(m => m.getOrderFlowIndicator().updateConfig(settings))}
            onClose={closeSettings}
          />
        );
      case 'FVG':
        return (
          <FVGSettings
            symbol={symbol}
            indicator={current.getFVGIndicator()}
            onApply={(settings) => applyToAll(m => m.getFVGIndicator().updateConfig(settings))}
            onClose={closeSettings}
          />
        );
      case 'VP Periodic':
        return (
          <VPPeriodicSettings
            symbol={symbol}
            indicator={current.getVPPeriodicIndicator()}
            onApply={(settings) => applyToAll(m => m.getVPPeriodicIndicator().updateConfig(settings))}
            onClose={closeSettings}
          />
        );
      case 'Volumen de Respuesta':
        return (
          <ResponseVolumeSettings
            symbol={symbol}
            indicator={current.getResponseVolumeIndicator()}
            onApply={(settings) => applyToAll(m => m.getResponseVolumeIndicator().updateConfig(settings))}
            onClose={closeSettings}
          />
        );
      case 'Liquidaciones':
        return (
          <LiquidationsSettings
            symbol={symbol}
            indicator={current.getLiquidationsIndicator()}
            onApply={(settings) => applyToAll(m => m.getLiquidationsIndicator().updateConfig(settings))}
            onClose={closeSettings}
          />
        );
      case 'Elementos OF':
        return (
          <OrderFlowElementsSettings
            symbol={symbol}
            indicator={current.getOFElementsIndicator()}
            onApply={(settings) => applyToAll(m => m.getOFElementsIndicator().updateConfig(settings))}
            onClose={closeSettings}
            onOpenSetups={() => setSettingsFor('Setups')}
          />
        );
      case 'Setups':
        return (
          <OrderFlowSetupsSettings
            symbol={symbol}
            indicator={current.getOFElementsIndicator()}
            onApply={(config) => applyToAll(m => m.getOFElementsIndicator().setSetupsConfig(config))}
            onClose={closeSettings}
          />
        );
      default:
        return null;
    }
  };

  const states = currentStates;
  const enabledCount = Object.values(states).filter(Boolean).length;
  const newTheme = isNewTheme();

  return (
    <div className="backtesting-container">
      <DrawingSidebar
        selectedTool={currentTool}
        onToolChange={setCurrentTool}
        onUndo={() => chartRefs.current[activeTimeframe]?.undo?.()}
        onRedo={() => chartRefs.current[activeTimeframe]?.redo?.()}
        onClearAll={() => {
          if (window.confirm(`¿Seguro que quieres borrar todos los dibujos de ${symbol}? Se borran en todos los marcos y en la otra pestaña.`)) {
            chartRefs.current[activeTimeframe]?.clearAll?.();
          }
        }}
        isCollapsed={sidebarCollapsed}
        isHidden={sidebarHidden}
        onToggleCollapse={() => {
          if (sidebarHidden) {
            setSidebarHidden(false);
            setSidebarCollapsed(false);
          } else if (sidebarCollapsed) {
            setSidebarHidden(true);
          } else {
            setSidebarCollapsed(true);
          }
        }}
      />
      {(sidebarHidden || sidebarCollapsed) && (
        <button
          className="btn-show-drawing-sidebar"
          onClick={() => { setSidebarHidden(false); setSidebarCollapsed(false); }}
          title="Mostrar la barra de dibujo"
        >
          {newTheme ? <Icon name="pencil" size={16} /> : '🖌'}
        </button>
      )}

      <div className="backtesting-header compact">
        <div className="header-left">
          <span className="app-title">📊</span>
          <select className="suite-select symbol-select" value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Moneda">
            {symbols.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {adding ? (
            <span className="suite-add">
              <input
                autoFocus
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === 'Enter') addSymbol(); if (e.key === 'Escape') setAdding(false); }}
                placeholder="Ej: LINKUSDT"
                aria-label="Moneda nueva"
              />
              <button type="button" className="btn-action-compact" onClick={addSymbol}>Agregar</button>
              <button type="button" className="btn-action-compact" onClick={() => { setAdding(false); setAddError(''); }}>×</button>
              {addError && <span className="suite-add-error">{addError}</span>}
            </span>
          ) : (
            <button type="button" className="btn-action-compact" onClick={() => setAdding(true)} title="Agregar una moneda de Bybit">+</button>
          )}
          {TAB > 1 && <span className="current-time-compact">Pestaña {TAB}</span>}
          <StatusDots onOpenBot={onOpenBot} />
        </div>

        <div className="header-center">
          <TimeframeTabs activeTimeframe={activeTimeframe} onTabChange={setActiveTimeframe} compact={true} />
        </div>

        <div className="header-right">
          <TabsMenu onModule={onModule} buttonClass="btn-action-compact theme-settings-btn">
            {newTheme ? <><Icon name="layers" size={15} /><span>Pestañas</span></> : '🗗'}
          </TabsMenu>
          {onOpenWatchlist && (
            <button className="btn-action-compact theme-settings-btn" onClick={onOpenWatchlist} title="Watchlist: todas las monedas en una cuadrícula">
              {newTheme ? <><Icon name="rect" size={15} /><span>Watchlist</span></> : '▦'}
            </button>
          )}
          <button className="btn-action-compact theme-settings-btn" onClick={onOpenBot} title="Bot: estado, configuración y riesgo">
            {newTheme ? <><Icon name="sliders" size={15} /><span>Bot</span></> : '🤖'}
          </button>
          <button className="btn-action-compact theme-settings-btn" onClick={onOpenTheme} title="Estilo y colores">
            {newTheme ? <><Icon name="palette" size={15} /><span>Estilo</span></> : '🎨'}
          </button>
          <div className="indicator-selector-compact" ref={listRef}>
            <button
              className="btn-action-compact indicators"
              onClick={() => setShowList(open => !open)}
              title="Indicadores"
              style={{ background: enabledCount > 0 ? '#4CAF50' : 'transparent', padding: '4px 8px' }}
            >
              {newTheme ? <><Icon name="layers" size={15} /><span>Indicadores {enabledCount}</span></> : `📊 (${enabledCount})`}
            </button>
            {showList && (
              <div
                className="indicator-list-panel"
                style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 5, background: 'white', border: '1px solid #ccc',
                  borderRadius: 4, padding: 10, minWidth: 250, maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 1000,
                }}
              >
                <h4 style={{ margin: '0 0 6px 0', fontSize: 14, color: '#333' }}>Indicadores ({view.mode === 'coin' ? symbol : 'todas las monedas'})</h4>
                {TAB > 1 && (
                  <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
                    {ownIndicators ? (
                      <>
                        Propios de esta pestaña.{' '}
                        <button type="button" onClick={followMainIndicators} style={{ fontSize: 11, padding: '1px 6px', cursor: 'pointer' }}>
                          Usar los de la pestaña 1
                        </button>
                      </>
                    ) : 'Los de la pestaña 1, al día. Si cambias uno, esta pestaña tendrá los suyos.'}
                  </div>
                )}
                <select
                  value={view.mode}
                  onChange={(e) => changeIndicatorMode(e.target.value)}
                  aria-label="Indicadores por moneda"
                  style={{ width: '100%', padding: '3px 4px', fontSize: 12, marginBottom: 4, border: '1px solid #ccc', borderRadius: 3, background: '#fff', color: '#333' }}
                >
                  <option value="shared">Los mismos en todas las monedas</option>
                  <option value="coin">Propios de cada moneda</option>
                </select>
                <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
                  Valen para los cinco marcos.{view.mode === 'coin' && !view.coin[symbol] ? ' Esta moneda usa los comunes hasta que cambies uno.' : ''}
                </div>
                {Object.entries(states).map(([name, enabled]) => (
                  <label key={name} style={{ display: 'block', padding: '6px 0', cursor: 'pointer', fontSize: 13, color: '#333' }}>
                    <input type="checkbox" checked={enabled} onChange={(e) => toggle(name, e.target.checked)} style={{ marginRight: 8 }} />
                    {name}
                    {name === 'Open Interest' && enabled && (
                      <select
                        value={tabStates[activeTimeframe].oiMode}
                        onChange={(e) => setTab(activeTimeframe, () => ({ oiMode: e.target.value }))}
                        onClick={(e) => e.stopPropagation()}
                        style={{ marginLeft: 8, padding: '2px 4px', fontSize: 11, border: '1px solid #ccc', borderRadius: 3, background: '#f5f5f5' }}
                      >
                        <option value="histogram">Histogram</option>
                        <option value="cumulative">Cumulative</option>
                        <option value="flow">Flow</option>
                      </select>
                    )}
                    {WITH_SETTINGS.has(name) && (
                      <span
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); openSettings(name); }}
                        style={{ marginLeft: 8, cursor: 'pointer', fontSize: 12, opacity: 0.7 }}
                        title={`Configurar ${name}`}
                      >
                        {newTheme ? <Icon name="sliders" size={13} /> : '⚙️'}
                      </span>
                    )}
                  </label>
                ))}
                <button
                  type="button"
                  onClick={() => TIMEFRAMES.forEach(tf => chartRefs.current[tf]?.resetPanels?.())}
                  style={{ width: '100%', marginTop: 8, padding: '4px 8px', fontSize: 11, color: '#333', background: '#f5f5f5', border: '1px solid #ccc', borderRadius: 3, cursor: 'pointer' }}
                >
                  Restablecer orden y altura de paneles
                </button>
                <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
                  Los footprints llegan hasta el último minuto guardado (cerca de 1 minuto atrás).
                </div>
              </div>
            )}
          </div>
          <button
            className="btn-action-compact"
            onClick={() => setShowTrading(v => !v)}
            title={showTrading ? 'Ocultar el panel de trading' : 'Mostrar el panel de trading'}
          >
            {showTrading ? '⟩' : '⟨'}
          </button>
        </div>
      </div>

      <div className="backtesting-main-wrapper" style={{ position: 'relative', display: 'flex' }}>
        <div
          className={`backtesting-main chart-with-sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${sidebarHidden ? 'sidebar-hidden' : ''}`}
          style={{ flex: 1, display: 'flex' }}
        >
          <div className="timeframes-container" ref={chartsBoxRef}>
            {TIMEFRAMES.map(tf => (
              <div key={tf} className="timeframe-panel" style={{ display: activeTimeframe === tf ? 'block' : 'none' }}>
                <MiniChart
                  ref={el => { chartRefs.current[tf] = el; }}
                  key={`${symbol}-${tf}`}
                  symbol={symbol}
                  interval={tf}
                  days={DAYS[tf]}
                  isActive={active && activeTimeframe === tf}
                  indicatorStates={currentStates}
                  backtestingMode={false}
                  vpConfig={tabStates[tf].vpConfig}
                  vpFixedRange={tabStates[tf].vpFixedRange}
                  oiMode={tabStates[tf].oiMode}
                  rejectionPatternConfig={rejectionConfig}
                  onOpenVpSettings={() => openSettings('Volume Profile')}
                  onOpenRangeDetectionSettings={() => openSettings('Range Detection')}
                  onOpenRejectionPatternSettings={() => openSettings('Rejection Patterns')}
                  onOpenSupportResistanceSettings={() => openSettings('Support & Resistance')}
                  onOpenVWAPSettings={() => openSettings('VWAP')}
                  onOpenDoubleTopBottomSettings={() => openSettings('Double Top/Bottom')}
                  onOpenSwingDetectorSettings={() => openSettings('Swing Detector')}
                  onOpenOIVolumeConfluenceSettings={() => openSettings('OI-Volume Confluence')}
                  currentTool={currentTool}
                  onToolChange={setCurrentTool}
                  getTradeBoundaries={noTrades}
                  getTradeBoxes={getTradeBoxes}
                  getPositionLines={getPositionLines}
                  onPositionAction={handlePositionAction}
                  chosenStyle="numbers"
                  chosenItems={analysisItems}
                  drawingsSource={analysisSource}
                  onRequestPause={noop}
                  onRequestTimeChange={noop}
                  onDrawingsChange={handleDrawingsChange}
                />
              </div>
            ))}
          </div>
          {focusedTrade && focusedTrade.symbol === symbol && (
            <div className="suite-result ok" style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 60, background: 'var(--t-chart, #fff)', marginTop: 0, width: 'max-content', maxWidth: '94%' }}>
              {analysis ? 'Análisis post-trade' : 'Trade del journal'}: {focusedTrade.side === 'Buy' ? 'LONG' : 'SHORT'} {focusedTrade.symbol}
              {focusedTrade.pnl !== null && focusedTrade.pnl !== undefined ? ` · ${focusedTrade.pnl >= 0 ? '+' : '−'}${Math.abs(focusedTrade.pnl).toFixed(2)} USD` : ''}
              {!analysis && (
                <>
                  {' '}<button type="button" className="suite-btn" onClick={() => setAnalysis(focusedTrade)}
                    title="Dibujar sobre el trade (por ejemplo sus conclusiones) y guardar una imagen en su journal. Lo dibujado queda en el trade, no en el gráfico de la moneda">
                    Análisis post-trade
                  </button>
                </>
              )}
              {analysis && (
                <>
                  {' '}<input type="text" className="suite-input" style={{ width: 260 }} maxLength={4000} placeholder="Conclusión (opcional)"
                    value={analysisNote} onChange={(e) => setAnalysisNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveAnalysisImage(); }} />
                  {' '}<button type="button" className="suite-btn" disabled={analysisBusy} onClick={saveAnalysisImage}>
                    {analysisBusy ? 'Guardando…' : 'Guardar imagen en el journal'}
                  </button>
                  {' '}<button type="button" className="suite-btn" onClick={() => setAnalysis(null)}>Terminar análisis</button>
                </>
              )}
              {' '}<button type="button" className="suite-btn" onClick={clearFocusedTrade}>Quitar</button>
              {analysis && (
                <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>
                  Lo que dibujes queda en este trade, no en el gráfico de la moneda, y vuelve al abrir su análisis otra vez. Los números son lo elegido para él.
                </div>
              )}
            </div>
          )}
          {positionNotice && (
            <div
              className={`suite-result ${positionNotice.ok ? 'ok' : 'bad'}`}
              style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', zIndex: 60, maxWidth: 560, background: 'var(--t-chart, #fff)', marginTop: 0 }}
              onClick={() => setPositionNotice(null)}
            >
              {positionNotice.message}
            </div>
          )}
        </div>

        <div className={`backtesting-sidebar ${showTrading ? '' : 'hidden'}`} style={{ width: showTrading ? 340 : 0 }}>
          <TradingPanel symbol={symbol} shapes={shapes} onClose={() => setShowTrading(false)} onDecision={handleDecision} />
        </div>
      </div>

      {settingsFor && renderSettings()}
      {offscreenJob && (
        <OffscreenCapture
          key={offscreenJob.id}
          job={offscreenJob}
          size={offscreenJob.size}
          tabState={{ ...tabStates[offscreenJob.tf], indicatorStates: offscreenStates }}
          swingVisual={swingVisual}
          rejectionConfig={rejectionConfig}
          onDone={finishOffscreen}
        />
      )}
    </div>
  );
}
