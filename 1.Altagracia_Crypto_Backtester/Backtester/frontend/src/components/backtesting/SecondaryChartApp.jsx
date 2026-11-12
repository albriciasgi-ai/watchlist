import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MiniChart from '../MiniChart';
import { API_BASE_URL } from '../../config.js';
import { useUiTheme } from '../useUiTheme.js';
import { isBlind, maskDate, setBlindAnchor, setBlindScale } from './blindClock.js';
import { withoutSubdivisions } from './marketData';
import { HEARTBEAT_MS, openReplayChannel, replayBasics, reportOf, sameBasics } from './replayChannel.js';
import { createFollower, createSourcePicker } from './replayFollower.js';
import '../../backtesting_styles.css'; // El gráfico llena su panel, como en la principal

/**
 * Segundo gráfico (?grafico=2): otra pestaña que sigue la reproducción de la principal, con su propio
 * marco e indicadores, para no saturar el gráfico principal. No tiene reloj ni órdenes: la hora, el
 * símbolo, la fecha oculta y las líneas de los trades llegan de la principal por BroadcastChannel.
 * Las velas salen del caché del navegador que guardó la principal (IndexedDB), o del backend.
 * Lo que se elige aquí para el análisis llega a la orden de la principal (analysisLevels usa localStorage).
 *
 * La principal informa la hora de su pantalla unas 9 veces por segundo. Aquí la hora avanza en cada cuadro
 * de la pantalla, minuto a minuto, sin pasar nunca de la última informada (replayFollower.js): así las
 * velas se ven formar también a 10000x, donde cada informe trae 19 minutos de golpe.
 */

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h'];
const MAX_DAYS = { '1m': 730, '5m': 1825, '15m': 1825, '1h': 1825, '4h': 1825 };
const SETTINGS_KEY = 'app1_grafico2';
const DAY_MS = 86400000;

// Los mismos indicadores que ofrece la principal, apagados salvo el volumen
const INDICATORS = [
  'Volume Delta', 'Volume Profile', 'CVD', 'Open Interest', 'OI-Volume Confluence', 'Order Flow', 'FVG', 'VP Periodic',
  'Volumen de Respuesta', 'Liquidaciones', 'Elementos OF', 'VWAP', 'Range Detection', 'Rejection Patterns',
  'Double Top/Bottom', 'Support & Resistance', 'S&R v2', 'Swing Detector'
];
const DEFAULT_ON = new Set(['Volume Delta']);

const DEFAULT_VP_CONFIG = {
  mode: 'dynamic', rowCount: 100, valueAreaPercent: 70, hideWhenFixedRanges: false, showPOC: true, showVAH: true, showVAL: true
};

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento la elección dura hasta cerrar la pestaña
  }
}

/** Las velas que guardó la principal en el navegador, o null */
function cachedMarketData(symbol) {
  return new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open('backtestingCache', 1);
    } catch {
      resolve(null);
      return;
    }
    request.onerror = () => resolve(null);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('marketData')) {
        const store = db.createObjectStore('marketData', { keyPath: 'symbol' });
        store.createIndex('savedAt', 'savedAt', { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('marketData')) {
        resolve(null);
        return;
      }
      const get = db.transaction(['marketData'], 'readonly').objectStore('marketData').get(symbol);
      get.onsuccess = () => resolve(get.result ? withoutSubdivisions(get.result.data) : null);
      get.onerror = () => resolve(null);
    };
  });
}

// La hora del encabezado cambia en cada cuadro al reproducir: el formato se arma una sola vez
const TIME_FORMAT = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
});
const formatTime = (time) => (isBlind() ? maskDate(time) : TIME_FORMAT.format(new Date(time)));

// Con miles de velas a la vista un dibujo tarda decenas de ms. La hora avanza entonces cada varios cuadros,
// para que dibujar no ocupe más de 2/5 del tiempo y el mouse siga respondiendo
const DRAW_HEADROOM = 2.5;
const MAX_COMMIT_GAP_MS = 250;

// ?grafico=2&medir=1 muestra en el encabezado cuántas veces por segundo llega la hora y cuántas se dibuja
const MEASURING = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('medir') === '1';

const SecondaryChartApp = () => {
  useUiTheme();
  const saved = useMemo(loadSettings, []);
  const [replay, setReplay] = useState(null); // Símbolo, inicio y fecha oculta de la principal: cambian poco
  const [shownTime, setShownTime] = useState(null); // Hora que se dibuja: la fija el seguidor en cada cuadro
  const [market, setMarket] = useState(null); // { symbol, data }: las velas, con el símbolo al que pertenecen
  const [measure, setMeasure] = useState(null);
  const [status, setStatus] = useState('Esperando a la pestaña principal…');
  const [timeframe, setTimeframe] = useState(TIMEFRAMES.includes(saved.timeframe) ? saved.timeframe : '1h');
  const [indicatorStates, setIndicatorStates] = useState(() => Object.fromEntries(
    INDICATORS.map(name => [name, saved.indicators?.[name] ?? DEFAULT_ON.has(name)])
  ));
  const [showList, setShowList] = useState(false);
  const [currentTool, setCurrentTool] = useState('select');
  const loadedSymbol = useRef(null);
  const channelRef = useRef(null);
  const timeframeRef = useRef(timeframe);
  const tradesRef = useRef([]);
  const boxesRef = useRef([]);
  const chartRef = useRef(null);
  // Lo que no pasa por React: el seguidor de la hora, la principal que se sigue y el cuadro pedido
  const followRef = useRef(null);
  if (!followRef.current) {
    followRef.current = {
      follower: createFollower(), picker: createSourcePicker(),
      basics: null, drawn: '', shown: null, frame: 0, committedAt: 0, reports: 0, commits: 0
    };
  }

  // Un cuadro de la pantalla: pregunta al seguidor qué hora toca y, si cambió, la pasa al gráfico.
  // Sigue pidiendo cuadros solo mientras queda tramo por recorrer
  const runFrames = useCallback(() => {
    const follow = followRef.current;
    if (follow.frame) return;
    const step = () => {
      follow.frame = 0;
      const now = performance.now();
      const cost = chartRef.current?.drawCost?.() || 0;
      const due = now - follow.committedAt >= Math.min(MAX_COMMIT_GAP_MS, cost * DRAW_HEADROOM) - 2;
      if (due) {
        const time = follow.follower.frame(now);
        if (time !== null && time !== follow.shown) {
          follow.shown = time;
          follow.committedAt = now;
          follow.commits++;
          setShownTime(time);
        }
      }
      if (!due || follow.follower.pending()) follow.frame = requestAnimationFrame(step);
    };
    follow.frame = requestAnimationFrame(step);
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(followRef.current.frame);
    followRef.current.frame = 0;
  }, []);

  useEffect(() => {
    document.title = 'App 1 · 2.º gráfico';
  }, []);

  // Escucha a la principal y le pide el estado al abrir
  useEffect(() => {
    const channel = openReplayChannel();
    if (!channel) {
      setStatus('Este navegador no permite comunicar pestañas (BroadcastChannel).');
      return undefined;
    }
    const hello = () => channel.postMessage({ type: 'hello', timeframe: timeframeRef.current });
    channel.onmessage = (event) => {
      const message = event.data;
      const follow = followRef.current;
      if (message?.type === 'gone') {
        follow.picker.release(message.source); // La principal se cerró o se recargó: la que informe ahora toma su lugar
        return;
      }
      const report = reportOf(message);
      if (!report) return;
      const now = performance.now();
      // Con dos pestañas principales abiertas se sigue una sola: atendiendo a las dos saltaría entre sus horas
      const { follow: mine, changed } = follow.picker.accept(message.source, report.time, now, report.playing);
      if (!mine) return;

      // La fecha oculta primero: nada de este estado se dibuja con la fecha o la escala anteriores
      setBlindAnchor(message.blindAnchor ?? null);
      setBlindScale(message.blindAnchor == null ? null : message.blindScale);
      const basics = replayBasics(message);
      const sameSimulation = sameBasics(follow.basics, basics);
      // Otra principal u otra simulación: la hora no se recorre desde la anterior, se toma la nueva
      if (changed || !sameSimulation) follow.follower.reset();
      if (changed) hello(); // La principal nueva todavía no sabe que este gráfico existe
      if (!sameSimulation) {
        follow.basics = basics;
        setReplay(basics);
      }

      tradesRef.current = message.trades || [];
      boxesRef.current = message.boxes || [];
      // El gráfico no se redibuja solo cuando cambian los trades o se revela la fecha: se le pide
      const drawn = JSON.stringify([message.trades, message.boxes, basics.blindAnchor, basics.blindScale]);
      if (drawn !== follow.drawn) {
        follow.drawn = drawn;
        chartRef.current?.redraw?.();
      }

      if (report.time !== follow.follower.state().target) follow.reports++;
      follow.follower.report(report, now);
      // Un retroceso tampoco espera al cuadro: con la pestaña oculta no hay cuadros y quedaría la hora posterior
      if (changed || !sameSimulation || (follow.shown !== null && report.time < follow.shown)) {
        // La hora nueva entra en el mismo render que el símbolo y la fecha oculta nuevos: el gráfico nunca
        // se dibuja con la hora de la simulación anterior
        follow.shown = report.time;
        follow.committedAt = now;
        setShownTime(report.time);
      }
      runFrames();
    };
    channelRef.current = channel;
    hello();
    // Mientras este gráfico está a la vista la principal avanza con pasos finos: se le avisa cada pocos
    // segundos. Oculto no avisa, y la principal vuelve a su paso de siempre
    const beat = setInterval(() => { if (!document.hidden) hello(); }, HEARTBEAT_MS);
    const onVisible = () => { if (!document.hidden) hello(); };
    document.addEventListener('visibilitychange', onVisible);
    // Al cerrar, la principal vuelve al paso de su propio marco
    const bye = () => channel.postMessage({ type: 'bye' });
    window.addEventListener('beforeunload', bye);
    return () => {
      clearInterval(beat);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('beforeunload', bye);
      channel.close();
      channelRef.current = null;
    };
  }, [runFrames]);

  // La principal sabe qué marco se mira aquí
  useEffect(() => {
    timeframeRef.current = timeframe;
    channelRef.current?.postMessage({ type: 'tf', timeframe });
  }, [timeframe]);

  // Velas del símbolo de la principal: del caché del navegador, o del backend
  useEffect(() => {
    const symbol = replay?.symbol;
    if (!symbol || loadedSymbol.current === symbol) return;
    loadedSymbol.current = symbol;
    let active = true;
    (async () => {
      setStatus(`Cargando las velas de ${symbol}…`);
      let data = await cachedMarketData(symbol);
      if (!data) {
        try {
          const response = await fetch(`${API_BASE_URL}/api/backtesting/bulk-data/${symbol}`);
          data = withoutSubdivisions(await response.json());
        } catch (error) {
          if (active) setStatus(`No se pudieron cargar las velas: ${error.message}`);
          return;
        }
      }
      if (!active) return;
      setMarket({ symbol, data });
      setStatus(null);
    })();
    return () => { active = false; };
  }, [replay?.symbol]);

  useEffect(() => {
    saveSettings({ timeframe, indicators: indicatorStates });
  }, [timeframe, indicatorStates]);

  const toggle = (name) => setIndicatorStates(previous => ({ ...previous, [name]: !previous[name] }));
  const getTradeBoundaries = useCallback(() => tradesRef.current, []);
  const getTradeBoxes = useCallback(() => boxesRef.current, []);
  const noop = useCallback(() => {}, []);

  // Solo cambia con la simulación o el marco. Calculado en cada render cambiaría al pasar la medianoche,
  // y el gráfico rearma sus indicadores cuando cambia
  const days = useMemo(() => (replay?.simulationStartTime
    ? Math.min(Math.ceil((Date.now() - replay.simulationStartTime) / DAY_MS), MAX_DAYS[timeframe])
    : MAX_DAYS[timeframe]), [replay?.simulationStartTime, timeframe]);

  // Medición a pedido (?grafico=2&medir=1): por segundo, cuántas horas distintas llegan y cuántas se dibujan
  useEffect(() => {
    if (!MEASURING) return undefined;
    const timer = setInterval(() => {
      const follow = followRef.current;
      const { target, shown, speed } = follow.follower.state();
      setMeasure({
        reports: follow.reports, commits: follow.commits,
        lag: target !== null && speed > 0 ? Math.round((target - shown) / speed) : 0,
        cost: chartRef.current?.drawCost?.() || 0
      });
      follow.reports = 0;
      follow.commits = 0;
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  const enabledCount = Object.values(indicatorStates).filter(Boolean).length;

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--t-page, #fff)', color: 'var(--t-text, #222)' }}>
      <div style={{ height: 38, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', borderBottom: '1px solid var(--t-line, #ddd)', fontSize: 13, flexShrink: 0 }}>
        <strong>{replay?.symbol || 'App 1'}</strong>
        <span style={{ opacity: 0.7 }}>2.º gráfico</span>
        {shownTime !== null && <span>{formatTime(shownTime)}</span>}
        <div style={{ display: 'flex', gap: 2, marginLeft: 12 }}>
          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              style={{
                padding: '3px 8px', fontSize: 12, cursor: 'pointer', borderRadius: 3,
                border: '1px solid var(--t-line, #ccc)',
                background: tf === timeframe ? 'var(--t-accent, #2962FF)' : 'var(--t-control, #f5f5f5)',
                color: tf === timeframe ? '#fff' : 'inherit'
              }}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setShowList(open => !open)}
            style={{ padding: '3px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 3, border: '1px solid var(--t-line, #ccc)', background: 'var(--t-control, #f5f5f5)', color: 'inherit' }}
          >
            Indicadores {enabledCount}
          </button>
          {showList && (
            <div style={{ position: 'absolute', top: 30, left: 0, zIndex: 2000, background: 'var(--t-surface, #fff)', border: '1px solid var(--t-line, #ccc)', borderRadius: 4, padding: 8, width: 240, maxHeight: '70vh', overflowY: 'auto', boxShadow: '0 4px 14px rgba(0,0,0,0.15)' }}>
              {INDICATORS.map(name => (
                <label key={name} style={{ display: 'block', padding: '4px 0', cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={!!indicatorStates[name]} onChange={() => toggle(name)} style={{ marginRight: 8 }} />
                  {name}
                </label>
              ))}
              <div style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}>Los ajustes de cada indicador son los de la pestaña principal.</div>
            </div>
          )}
        </div>
        {measure && (
          <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.7 }}>
            hora recibida {measure.reports}/s · dibujada {measure.commits}/s · atraso {measure.lag} ms · dibujo {measure.cost.toFixed(1)} ms
          </span>
        )}
        <span style={{ marginLeft: measure ? 12 : 'auto', fontSize: 11, opacity: 0.7 }}>
          {replay ? 'Sigue la reproducción de la pestaña principal' : 'Sin conexión con la pestaña principal'}
        </span>
      </div>

      <div className="backtesting-main" style={{ flex: 1, position: 'relative', minHeight: 0 }} onMouseDown={() => setShowList(false)}>
        {status && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, opacity: 0.8 }}>
            {status}
          </div>
        )}
        {!status && replay && shownTime !== null && market?.symbol === replay.symbol && (
          <div className="timeframe-panel" style={{ position: 'absolute', inset: 0 }}>
            <MiniChart
              ref={chartRef}
              key={`${replay.symbol}-${timeframe}-${replay.simulationStartTime}`}
              symbol={replay.symbol}
              interval={timeframe}
              days={days}
              isActive={true}
              indicatorStates={indicatorStates}
              backtestingMode={true}
              backtestingData={market.data}
              currentTime={shownTime}
              simulationStartTime={replay.simulationStartTime}
              vpConfig={DEFAULT_VP_CONFIG}
              vpFixedRange={null}
              oiMode="histogram"
              rejectionPatternConfig={null}
              currentTool={currentTool}
              onToolChange={setCurrentTool}
              getTradeBoundaries={getTradeBoundaries}
              getTradeBoxes={getTradeBoxes}
              onRequestPause={noop}
              onRequestTimeChange={noop}
              onDrawingsChange={noop}
              onCandleClick={noop}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default SecondaryChartApp;
