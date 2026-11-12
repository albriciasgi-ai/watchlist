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
import { getJson, postJson } from './api.js';
import { TAB, otherTabUrl, onDrawings, sendDrawings } from './tabs.js';

/**
 * Grafico en vivo con el formato de la pestana principal de App 1: barra de dibujo, encabezado con los
 * marcos, un MiniChart por marco (cambiar de marco no recarga) y el panel de trading a la derecha.
 * Cada pestana (1 y 2) tiene sus indicadores; los dibujos son por moneda y se comparten al instante.
 */

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h'];
// Dias de velas por marco (el servidor tiene el mismo tope)
const DAYS = { '1m': 3, '5m': 10, '15m': 30, '1h': 120, '4h': 365 };

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
      indicatorStates: { ...DEFAULT_STATES, ...(own.indicatorStates || {}) },
      vpConfig: { ...DEFAULT_VP_CONFIG, ...(own.vpConfig || {}) },
      vpFixedRange: null,
      oiMode: own.oiMode || 'histogram',
    }];
  }));
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

export default function ChartView({ active = true, onOpenBot, onOpenTheme }) {
  const saved = useMemo(loadSettings, []);
  const chartRefs = useRef({});
  const [symbols, setSymbols] = useState([saved.symbol || 'BTCUSDT']);
  const [symbol, setSymbol] = useState(saved.symbol || 'BTCUSDT');
  const [activeTimeframe, setActiveTimeframe] = useState(TIMEFRAMES.includes(saved.timeframe) ? saved.timeframe : '15m');
  const [tabStates, setTabStates] = useState(() => initialTabStates(saved));
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
  const listRef = useRef(null);

  const readSymbols = useCallback(() => getJson('/api/suite/symbols').then(d => setSymbols(d.symbols)).catch(() => {}), []);
  useEffect(() => { readSymbols(); }, [readSymbols]);

  useEffect(() => {
    try {
      const tabs = Object.fromEntries(TIMEFRAMES.map(tf => [tf, {
        indicatorStates: tabStates[tf].indicatorStates, vpConfig: tabStates[tf].vpConfig, oiMode: tabStates[tf].oiMode,
      }]));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ symbol, timeframe: activeTimeframe, tabs, showTrading }));
    } catch {
      // Sin almacenamiento la eleccion dura hasta cerrar la pagina
    }
  }, [symbol, activeTimeframe, tabStates, showTrading]);

  // Solo en desarrollo: acceso a los graficos desde la consola para revisarlos
  useEffect(() => {
    if (import.meta.env.DEV) window.__suiteCharts = chartRefs;
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

  // Dibujos: los mismos en los cinco marcos y en la otra pestana, si mira la misma moneda
  const loadEverywhere = useCallback((list, except) => {
    TIMEFRAMES.forEach(tf => {
      if (tf !== except) chartRefs.current[tf]?.loadDrawings?.(list, true);
    });
    setShapes(list);
  }, []);
  const handleDrawingsChange = useCallback((list, sourceInterval) => {
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
  const toggle = (name, value) => setTab(activeTimeframe, s => ({ indicatorStates: { ...s.indicatorStates, [name]: value } }));
  const closeSettings = () => setSettingsFor(null);
  const noop = useCallback(() => {}, []);
  const noTrades = useCallback(() => [], []);

  const openSettings = (name) => {
    if (!manager()) {
      alert('El gráfico todavía está cargando. Espera unos segundos e inténtalo de nuevo.');
      return;
    }
    setShowList(false);
    setSettingsFor(name);
  };

  const addSymbol = async () => {
    const s = newSymbol.trim().toUpperCase();
    if (!s) return;
    setAddError('');
    try {
      const d = await postJson('/api/suite/symbols', { symbol: s });
      setSymbols(d.symbols);
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
      case 'Swing Detector':
        return (
          <ModalBox onClose={closeSettings} width={700}>
            <SwingDetectorSettings
              symbol={symbol}
              config={current.getIndicatorConfig('Swing Detector')}
              onConfigChange={async (newConfig) => { await current.applyConfig('Swing Detector', newConfig); redraw(); }}
              onClose={closeSettings}
            />
          </ModalBox>
        );
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

  const states = tabStates[activeTimeframe].indicatorStates;
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
          {TAB === 2 && <span className="current-time-compact">Pestaña 2</span>}
          <StatusDots onOpenBot={onOpenBot} />
        </div>

        <div className="header-center">
          <TimeframeTabs activeTimeframe={activeTimeframe} onTabChange={setActiveTimeframe} compact={true} />
        </div>

        <div className="header-right">
          <button
            className="btn-action-compact theme-settings-btn"
            onClick={() => window.open(otherTabUrl(), TAB === 1 ? 'suite_pestana_2' : 'suite_pestana_1')}
            title={TAB === 1 ? 'Abrir la 2.ª pestaña: sus propios marcos e indicadores, los mismos dibujos' : 'Ir a la pestaña principal'}
          >
            {newTheme ? <><Icon name="layers" size={15} /><span>{TAB === 1 ? '2.ª pestaña' : 'Principal'}</span></> : '🗗'}
          </button>
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
                <h4 style={{ margin: '0 0 10px 0', fontSize: 14, color: '#333' }}>Indicadores ({activeTimeframe})</h4>
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
          <div className="timeframes-container">
            {TIMEFRAMES.map(tf => (
              <div key={tf} className="timeframe-panel" style={{ display: activeTimeframe === tf ? 'block' : 'none' }}>
                <MiniChart
                  ref={el => { chartRefs.current[tf] = el; }}
                  key={`${symbol}-${tf}`}
                  symbol={symbol}
                  interval={tf}
                  days={DAYS[tf]}
                  isActive={active && activeTimeframe === tf}
                  indicatorStates={tabStates[tf].indicatorStates}
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
                  onRequestPause={noop}
                  onRequestTimeChange={noop}
                  onDrawingsChange={handleDrawingsChange}
                />
              </div>
            ))}
          </div>
        </div>

        <div className={`backtesting-sidebar ${showTrading ? '' : 'hidden'}`} style={{ width: showTrading ? 340 : 0 }}>
          <TradingPanel symbol={symbol} shapes={shapes} onClose={() => setShowTrading(false)} />
        </div>
      </div>

      {settingsFor && renderSettings()}
    </div>
  );
}
