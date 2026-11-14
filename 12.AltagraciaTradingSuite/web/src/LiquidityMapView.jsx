import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MiniChart from '@app1/components/MiniChart';
import { LIQUIDITY_MAP_MINUTES } from '@app1/components/indicators/LiquidityMapIndicator.js';
import { SUSTAINED_LEVELS_MINUTES } from '@app1/components/indicators/SustainedLevelsIndicator.js';
import { getJson } from './api.js';
import { linesFor, subscribeBook } from './botBook.js';
import { TAB, URL_SYMBOL, URL_TIMEFRAME, onAnyDrawings, onSymbolsChanged } from './tabs.js';
import TabsMenu from './TabsMenu.jsx';
import LadderPanel, { LADDER_WIDTH } from './LadderPanel.jsx';

/**
 * Pestaña "Mapa" (13/11/2026): el mapa de liquidez del libro grabado, en un gráfico aparte. Pedido del usuario: verlo
 * en otra pestaña, sin mezclarlo con el gráfico principal ni con los indicadores que ya usa.
 * - El gráfico solo trae el mapa (detrás de las velas): ningún otro indicador. Los dibujos de la moneda se ven, para
 *   mirar la liquidez en tus zonas, pero aquí no se mueven ni se borran (viewOnly).
 * - "Solo la sostenida" deja lo que estuvo los últimos N minutos hasta el cierre de cada vela; "Toda la liquidez", el
 *   promedio de la vela. Sale de /api/book/heatmap del servidor, con lo grabado en el PC y lo bajado de la nube.
 * - Se abre con el botón "Mapa" del gráfico principal, con su moneda y su marco, y lo sigue hasta que aquí se elija
 *   otra moneda u otro marco. También desde el menú "Pestañas".
 * - "Compra y venta" (14/11/2026, de fábrica): cada lado en su color; "Una escala" las suma como antes.
 * - "Niveles" (14/11/2026): los niveles de liquidez sostenida (book_levels.py), encima del mapa, con cómo terminó cada uno.
 * - "Defensa" (14/11/2026): en cada llegada del precio a tus líneas y rectángulos, qué hizo la liquidez (la regla de
 *   book_study, /api/book/defense), y el estado de las zonas cerca del precio.
 * - El ladder (14/11/2026), a la derecha: el libro de ahora de la misma moneda, del grabador de la suite. Se oculta con
 *   el botón "Ladder".
 */

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h'];
const DAYS = { '1m': 3, '5m': 10, '15m': 30, '1h': 120, '4h': 365 }; // los del gráfico principal
const MAP_NAME = 'Mapa de liquidez';
const LEVELS_NAME = 'Niveles sostenidos';
const STATES = { [MAP_NAME]: true }; // nada más: los demás quedan apagados
const STATES_WITH_LEVELS = { [MAP_NAME]: true, [LEVELS_NAME]: true };
const DEFENSE_NAME = 'Defensa de zona';
const VP_CONFIG = { mode: 'dynamic', rowCount: 100, valueAreaPercent: 70, hideWhenFixedRanges: false, showPOC: true, showVAH: true, showVAL: true };
const SETTINGS_KEY = `suite_mapa_${TAB}`;
const MAIN_SETTINGS_KEY = 'suite_chart_1';
const noop = () => {};
const none = () => [];

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

function mainChart() {
  try {
    const s = JSON.parse(localStorage.getItem(MAIN_SETTINGS_KEY)) || {};
    return { symbol: typeof s.symbol === 'string' ? s.symbol : null, timeframe: TIMEFRAMES.includes(s.timeframe) ? s.timeframe : null };
  } catch {
    return { symbol: null, timeframe: null };
  }
}

export default function LiquidityMapView({ active = true, onBack = null, onOpenTheme, onModule = null }) {
  const saved = useMemo(loadSettings, []);
  const start = useMemo(mainChart, []);
  const [symbol, setSymbol] = useState(URL_SYMBOL || saved.symbol || start.symbol || 'BTCUSDT');
  const [tf, setTf] = useState(URL_TIMEFRAME || (TIMEFRAMES.includes(saved.timeframe) ? saved.timeframe : null) || start.timeframe || '15m');
  const [mode, setMode] = useState(saved.mode === 'toda' ? 'toda' : 'sostenida');
  const [minutes, setMinutes] = useState(LIQUIDITY_MAP_MINUTES.includes(saved.minutes) ? saved.minutes : 30);
  const [sides, setSides] = useState(saved.sides !== false);
  // Sigue al gráfico principal (pestaña 1) mientras no se elija aquí otra moneda u otro marco
  const [follow, setFollow] = useState(TAB !== 1 && (URL_SYMBOL ? true : saved.follow !== false));
  const [ladderOn, setLadderOn] = useState(saved.ladder !== false);
  const [levelsOn, setLevelsOn] = useState(saved.levels !== false);
  const [defenseOn, setDefenseOn] = useState(saved.defense !== false);
  const [levelMinutes, setLevelMinutes] = useState(SUSTAINED_LEVELS_MINUTES.includes(saved.levelMinutes) ? saved.levelMinutes : 30);
  const [ladder, setLadder] = useState(() => {
    const v = saved.ladderSettings && typeof saved.ladderSettings === 'object' ? { ...saved.ladderSettings } : {};
    // Antes del 14/11 el step era uno para todas las monedas: queda para la moneda que se miraba
    if (v.step && !v.steps) v.steps = { [saved.symbol || symbol]: v.step };
    delete v.step;
    return v;
  });
  const [symbols, setSymbols] = useState([symbol]);
  const chartRef = useRef(null);
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ symbol, timeframe: tf, mode, minutes, follow, ladder: ladderOn, ladderSettings: ladder, levels: levelsOn, levelMinutes, sides, defense: defenseOn }));
    } catch {
      // Sin almacenamiento la elección dura hasta cerrar la pestaña
    }
  }, [symbol, tf, mode, minutes, follow, ladderOn, ladder, levelsOn, levelMinutes, sides, defenseOn]);

  useEffect(() => {
    getJson('/api/suite/symbols').then(d => setSymbols(d.symbols)).catch(() => {});
    return onSymbolsChanged(list => setSymbols(list));
  }, []);

  useEffect(() => {
    if (!follow || TAB === 1) return undefined;
    const apply = () => {
      const main = mainChart();
      if (main.symbol) setSymbol(main.symbol);
      if (main.timeframe) setTf(main.timeframe);
    };
    apply();
    const onStorage = (e) => { if (e.key === MAIN_SETTINGS_KEY) apply(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [follow]);

  // El modo y los minutos van al indicador del gráfico (uno nuevo al cambiar de moneda o de marco)
  useEffect(() => {
    const apply = () => {
      const indicator = chartRef.current?.getIndicatorManager?.()?.liquidityMapIndicator;
      if (!indicator) return false;
      indicator.updateConfig({ mode, minutes, sides });
      return true;
    };
    if (apply()) return undefined;
    const timer = setInterval(() => { if (apply()) clearInterval(timer); }, 300);
    return () => clearInterval(timer);
  }, [mode, minutes, sides, symbol, tf]);

  // Los minutos de los niveles sostenidos, igual
  useEffect(() => {
    const apply = () => {
      const indicator = chartRef.current?.getIndicatorManager?.()?.sustainedLevelsIndicator;
      if (!indicator) return false;
      indicator.updateConfig({ minutes: levelMinutes });
      return true;
    };
    if (apply()) return undefined;
    const timer = setInterval(() => { if (apply()) clearInterval(timer); }, 300);
    return () => clearInterval(timer);
  }, [levelMinutes, symbol, tf]);

  // Los dibujos que cambian en el gráfico principal o en otra pestaña llegan aquí (aquí no se editan)
  useEffect(() => onAnyDrawings((sym, shapes) => {
    if (sym !== symbolRef.current) return;
    chartRef.current?.loadDrawings?.(shapes, true);
    chartRef.current?.getIndicatorManager?.()?.zoneDefenseIndicator?.refresh();   // otras zonas
  }), []);
  // Las posiciones y órdenes del bot: solo sus líneas, sin acciones
  useEffect(() => subscribeBook(() => chartRef.current?.redraw?.()), []);
  const positions = useCallback(() => linesFor(symbolRef.current), []);

  // Al volver a la pestaña, el gráfico se dibuja con su tamaño real
  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(() => chartRef.current?.forceRedraw?.(), 60);
    return () => clearTimeout(timer);
  }, [active]);

  // Al mostrar u ocultar el ladder el gráfico cambia de ancho
  useEffect(() => {
    const timer = setTimeout(() => chartRef.current?.forceRedraw?.(), 60);
    return () => clearTimeout(timer);
  }, [ladderOn]);

  const states = useMemo(() => ({ ...(levelsOn ? STATES_WITH_LEVELS : STATES), ...(defenseOn ? { [DEFENSE_NAME]: true } : {}) }),
    [levelsOn, defenseOn]);

  const pickSymbol = (s) => { setFollow(false); setSymbol(s); };
  const pickTf = (t) => { setFollow(false); setTf(t); };

  return (
    <div className="suite-root">
      <div className="suite-bar">
        {onBack && <button type="button" className="suite-btn" onClick={onBack}>← Gráfico</button>}
        <span className="suite-title">Mapa de liquidez{TAB > 1 ? ` · pestaña ${TAB}` : ''}</span>
        <select className="suite-select" value={symbol} onChange={(e) => pickSymbol(e.target.value)} aria-label="Moneda">
          {(symbols.includes(symbol) ? symbols : [symbol, ...symbols]).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {TIMEFRAMES.map(t => (
          <button key={t} type="button" className={`suite-btn ${t === tf ? 'active' : ''}`} onClick={() => pickTf(t)}>{t}</button>
        ))}
        <select className="suite-select" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Qué liquidez mostrar"
          title="Solo la sostenida: lo que estuvo los últimos minutos hasta el cierre de cada vela, sin lo que aparece y desaparece. Toda: el promedio de la vela">
          <option value="sostenida">Solo la sostenida</option>
          <option value="toda">Toda la liquidez</option>
        </select>
        {mode === 'sostenida' && (
          <select className="suite-select" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Minutos sostenida">
            {LIQUIDITY_MAP_MINUTES.map(m => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
          </select>
        )}
        <select className="suite-select" value={sides ? 'lados' : 'una'} onChange={(e) => setSides(e.target.value === 'lados')}
          aria-label="Colores del mapa" title="Compra y venta: cada lado en su color, así se ve un soporte que pasa a resistencia. Una escala: las dos sumadas">
          <option value="lados">Compra y venta</option>
          <option value="una">Una escala</option>
        </select>
        {TAB !== 1 && (
          <label className="wl-muted" title="Cambia de moneda y de marco con el gráfico principal">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Seguir al gráfico principal
          </label>
        )}
        <button type="button" className={`suite-btn ${levelsOn ? 'active' : ''}`} onClick={() => setLevelsOn(v => !v)}
          title="Niveles de liquidez sostenida: solo lo grande que esperó en el libro al menos los minutos elegidos, y cómo terminó (● consumido, × retirado)">Niveles</button>
        {levelsOn && (
          <select className="suite-select" value={levelMinutes} onChange={(e) => setLevelMinutes(Number(e.target.value))} aria-label="Minutos de los niveles sostenidos"
            title="Cuánto debe esperar en el libro para ser un nivel sostenido">
            {SUSTAINED_LEVELS_MINUTES.map(m => <option key={m} value={m}>{`≥ ${m < 60 ? `${m} min` : `${m / 60} h`}`}</option>)}
          </select>
        )}
        <button type="button" className={`suite-btn ${defenseOn ? 'active' : ''}`} onClick={() => setDefenseOn(v => !v)}
          title="Defensa de zona: qué hizo la liquidez cuando el precio llegó a tus líneas y rectángulos, y el estado de las zonas cerca del precio">Defensa</button>
        <button type="button" className={`suite-btn ${ladderOn ? 'active' : ''}`} onClick={() => setLadderOn(v => !v)}
          title="El libro de ahora de esta moneda, a la derecha del mapa">Ladder</button>
        <div className="suite-spacer" />
        <span className="wl-muted" title="El libro completo se graba desde el 13/11/2026: antes no hay mapa">Libro grabado desde el 13/11 · solo para mirar</span>
        <TabsMenu onModule={onModule} />
        <button type="button" className="suite-btn" onClick={onOpenTheme}>Estilo</button>
      </div>
      <div className="suite-main">
        <div className="wl-chart" style={{ position: 'absolute', top: 0, left: 0, bottom: 0, right: ladderOn ? LADDER_WIDTH : 0 }}>
          <div className="backtesting-main" style={{ height: '100%' }}>
            <div className="timeframes-container" style={{ height: '100%' }}>
              <div className="timeframe-panel" style={{ display: 'block', height: '100%' }}>
                <MiniChart
                  key={`${symbol}-${tf}`}
                  ref={chartRef}
                  symbol={symbol}
                  interval={tf}
                  days={DAYS[tf]}
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
                  getPositionLines={positions}
                  chosenStyle="numbers"
                  liveRedrawMs={active ? 250 : 30000}
                  viewOnly
                  onRequestPause={noop}
                  onRequestTimeChange={noop}
                  onDrawingsChange={noop}
                />
              </div>
            </div>
          </div>
        </div>
        {ladderOn && (
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: LADDER_WIDTH }}>
            <LadderPanel symbol={symbol} active={active} settings={ladder} onSettings={(patch) => setLadder(v => ({ ...v, ...patch }))} />
          </div>
        )}
      </div>
    </div>
  );
}
