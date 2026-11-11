import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MiniChart from '../MiniChart';
import { API_BASE_URL } from '../../config.js';
import { useUiTheme } from '../useUiTheme.js';
import { isBlind, maskDate, setBlindAnchor, setBlindScale } from './blindClock.js';
import { withoutSubdivisions } from './marketData';
import { openReplayChannel } from './replayChannel.js';
import '../../backtesting_styles.css'; // El gráfico llena su panel, como en la principal

/**
 * Segundo gráfico (?grafico=2): otra pestaña que sigue la reproducción de la principal, con su propio
 * marco e indicadores, para no saturar el gráfico principal. No tiene reloj ni órdenes: la hora, el
 * símbolo, la fecha oculta y las líneas de los trades llegan de la principal por BroadcastChannel.
 * Las velas salen del caché del navegador que guardó la principal (IndexedDB), o del backend.
 * Lo que se elige aquí para el análisis llega a la orden de la principal (analysisLevels usa localStorage).
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

const formatTime = (time) => (isBlind() ? maskDate(time) : new Date(time).toLocaleString('es-CO', {
  timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
}));

const SecondaryChartApp = () => {
  useUiTheme();
  const saved = useMemo(loadSettings, []);
  const [replay, setReplay] = useState(null); // Último estado de la principal
  const [marketData, setMarketData] = useState(null);
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
  const followRef = useRef({ source: null, last: new Map() }); // Principal que se sigue y última hora de cada una

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
    channel.onmessage = (event) => {
      const message = event.data;
      if (message?.type !== 'state') return;
      // Con dos pestañas principales abiertas (una vieja, o la misma recargada) el gráfico saltaba entre
      // sus horas. Se sigue una sola, y se cambia a otra solo cuando su hora avanza
      const follow = followRef.current;
      const source = message.source ?? 'sin-id';
      const previous = follow.last.get(source);
      follow.last.set(source, message.currentTime);
      const moving = previous !== undefined && previous !== message.currentTime;
      if (follow.source && source !== follow.source && !moving) return;
      follow.source = source;
      setBlindAnchor(message.blindAnchor ?? null);
      setBlindScale(message.blindAnchor == null ? null : message.blindScale);
      tradesRef.current = message.trades || [];
      boxesRef.current = message.boxes || [];
      setReplay(message);
    };
    channelRef.current = channel;
    const hello = () => channel.postMessage({ type: 'hello', timeframe: timeframeRef.current });
    hello();
    const retry = setInterval(hello, 3000);
    const stop = setTimeout(() => clearInterval(retry), 30000);
    // Al cerrar, la principal vuelve al paso de su propio marco
    const bye = () => channel.postMessage({ type: 'bye' });
    window.addEventListener('beforeunload', bye);
    return () => {
      clearInterval(retry);
      clearTimeout(stop);
      window.removeEventListener('beforeunload', bye);
      channel.close();
      channelRef.current = null;
    };
  }, []);

  // La principal avanza con el paso del marco más fino a la vista: le avisa el marco de este gráfico
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
      setMarketData(data);
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

  const days = replay?.simulationStartTime
    ? Math.min(Math.ceil((Date.now() - replay.simulationStartTime) / DAY_MS), MAX_DAYS[timeframe])
    : MAX_DAYS[timeframe];
  const enabledCount = Object.values(indicatorStates).filter(Boolean).length;

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--t-page, #fff)', color: 'var(--t-text, #222)' }}>
      <div style={{ height: 38, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', borderBottom: '1px solid var(--t-line, #ddd)', fontSize: 13, flexShrink: 0 }}>
        <strong>{replay?.symbol || 'App 1'}</strong>
        <span style={{ opacity: 0.7 }}>2.º gráfico</span>
        {replay?.currentTime && <span>{formatTime(replay.currentTime)}</span>}
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
        <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.7 }}>
          {replay ? 'Sigue la reproducción de la pestaña principal' : 'Sin conexión con la pestaña principal'}
        </span>
      </div>

      <div className="backtesting-main" style={{ flex: 1, position: 'relative', minHeight: 0 }} onMouseDown={() => setShowList(false)}>
        {status && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, opacity: 0.8 }}>
            {status}
          </div>
        )}
        {!status && marketData && replay && (
          <div className="timeframe-panel" style={{ position: 'absolute', inset: 0 }}>
            <MiniChart
              key={`${replay.symbol}-${timeframe}`}
              symbol={replay.symbol}
              interval={timeframe}
              days={days}
              isActive={true}
              indicatorStates={indicatorStates}
              backtestingMode={true}
              backtestingData={marketData}
              currentTime={replay.currentTime}
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
