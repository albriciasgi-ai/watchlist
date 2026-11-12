import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MiniChart from '@app1/components/MiniChart';
import VolumeProfileSettings from '@app1/components/VolumeProfileSettings';
import SupportResistance2Settings from '@app1/components/SupportResistance2Settings';
import OrderFlowSettings from '@app1/components/OrderFlowSettings';
import FVGSettings from '@app1/components/FVGSettings';
import LiquidationsSettings from '@app1/components/LiquidationsSettings';
import VPPeriodicSettings from '@app1/components/VPPeriodicSettings';
import ResponseVolumeSettings from '@app1/components/ResponseVolumeSettings';

/**
 * Grafico en vivo: el MiniChart de App 1 en su modo en tiempo real (velas de Bybit por WebSocket).
 * Los footprints salen del almacen de order flow con la finura de App 1: dias oficiales, y donde faltan,
 * lo grabado por la nube y por el PC (llega hasta el ultimo minuto guardado, cerca de 1 minuto atras).
 */

const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'TRXUSDT', 'PAXGUSDT', 'GALAUSDT', 'SUIUSDT', 'TRBUSDT',
  'DOGEUSDT', 'AAVEUSDT', 'AVAXUSDT', 'ARBUSDT', 'BNBUSDT', 'INJUSDT', 'KASUSDT', 'SHIB1000USDT', 'UNIUSDT', 'LPTUSDT',
];
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h'];
// Dias de velas por marco (el servidor tiene el mismo tope)
const DAYS = { '1m': 3, '5m': 10, '15m': 30, '1h': 120, '4h': 365 };

// Indicadores de App 1 que funcionan en vivo con el servidor de la suite. Interes abierto, VWAP, S&R clasico,
// Elementos OF y los patrones piden rutas que el servidor aun no tiene
const INDICATORS = [
  'Volume Delta', 'Volume Profile', 'CVD', 'Order Flow', 'FVG', 'VP Periodic', 'Volumen de Respuesta', 'Liquidaciones', 'S&R v2',
];
const DEFAULT_ON = new Set(['Volume Delta', 'Order Flow']);
const WITH_SETTINGS = new Set(['Volume Profile', 'Order Flow', 'FVG', 'VP Periodic', 'Volumen de Respuesta', 'Liquidaciones', 'S&R v2']);
const ALL_APP1 = [
  'Volume Delta', 'Volume Profile', 'CVD', 'Open Interest', 'OI-Volume Confluence', 'Order Flow', 'FVG', 'VP Periodic',
  'Volumen de Respuesta', 'Liquidaciones', 'Elementos OF', 'VWAP', 'Range Detection', 'Rejection Patterns',
  'Double Top/Bottom', 'Support & Resistance', 'S&R v2', 'Swing Detector',
];
const DEFAULT_VP_CONFIG = {
  mode: 'dynamic', rowCount: 100, valueAreaPercent: 70, hideWhenFixedRanges: false, showPOC: true, showVAH: true, showVAL: true,
};
const SETTINGS_KEY = 'suite_chart';

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
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

export default function ChartView({ active = true }) {
  const saved = useMemo(loadSettings, []);
  const chartRef = useRef(null);
  const [symbol, setSymbol] = useState(SYMBOLS.includes(saved.symbol) ? saved.symbol : 'BTCUSDT');
  const [timeframe, setTimeframe] = useState(TIMEFRAMES.includes(saved.timeframe) ? saved.timeframe : '15m');
  const [indicatorStates, setIndicatorStates] = useState(() => Object.fromEntries(
    ALL_APP1.map(name => [name, INDICATORS.includes(name) && (saved.indicators?.[name] ?? DEFAULT_ON.has(name))])
  ));
  const [vpConfig, setVpConfig] = useState(() => ({ ...DEFAULT_VP_CONFIG, ...(saved.vpConfig || {}) }));
  const [vpFixedRange, setVpFixedRange] = useState(null);
  const [showList, setShowList] = useState(false);
  const [settingsFor, setSettingsFor] = useState(null);
  const [currentTool, setCurrentTool] = useState('select');

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ symbol, timeframe, indicators: indicatorStates, vpConfig }));
    } catch {
      // Sin almacenamiento la eleccion dura hasta cerrar la pagina
    }
  }, [symbol, timeframe, indicatorStates, vpConfig]);

  // Solo en desarrollo: acceso al grafico desde la consola para revisarlo
  useEffect(() => {
    if (import.meta.env.DEV) window.__suiteChart = chartRef;
  }, []);

  // Al volver a la pestana el grafico se redibuja con su tamano real
  useEffect(() => {
    if (active) setTimeout(() => chartRef.current?.forceRedraw?.(), 50);
  }, [active]);

  const toggle = (name) => setIndicatorStates(previous => ({ ...previous, [name]: !previous[name] }));
  const manager = () => chartRef.current?.getIndicatorManager?.() || null;
  const applyHere = (change) => {
    const current = manager();
    if (!current) return;
    change(current);
    chartRef.current?.forceRedraw?.();
  };
  const closeSettings = () => setSettingsFor(null);
  const noop = useCallback(() => {}, []);
  const noTrades = useCallback(() => [], []);

  const renderSettings = () => {
    const current = settingsFor ? manager() : null;
    if (!current) return null;
    switch (settingsFor) {
      case 'Volume Profile':
        return (
          <ModalBox onClose={closeSettings}>
            <h3 style={{ marginTop: 0 }}>Volume Profile</h3>
            <VolumeProfileSettings
              config={vpConfig}
              onConfigChange={(next) => setVpConfig(previous => ({ ...previous, ...next }))}
              onFixedRangeChange={(start, end) => setVpFixedRange({ start, end, applyToAll: false, symbol })}
              applyToAll={false}
              onApplyToAllChange={noop}
              currentSymbol={symbol}
            />
          </ModalBox>
        );
      case 'S&R v2':
        return (
          <SupportResistance2Settings
            symbol={symbol}
            indicatorManager={current}
            onConfigChange={config => applyHere(m => m.supportResistance2Indicator?.updateConfig(config))}
            onClose={closeSettings}
          />
        );
      case 'Order Flow':
        return (
          <OrderFlowSettings
            symbol={symbol}
            indicator={current.getOrderFlowIndicator()}
            activeTimeframe={timeframe}
            onApply={(settings) => applyHere(m => m.getOrderFlowIndicator().updateConfig(settings))}
            onClose={closeSettings}
          />
        );
      case 'FVG':
        return (
          <FVGSettings
            symbol={symbol}
            indicator={current.getFVGIndicator()}
            onApply={(settings) => applyHere(m => m.getFVGIndicator().updateConfig(settings))}
            onClose={closeSettings}
          />
        );
      case 'VP Periodic':
        return (
          <VPPeriodicSettings
            symbol={symbol}
            indicator={current.getVPPeriodicIndicator()}
            onApply={(settings) => applyHere(m => m.getVPPeriodicIndicator().updateConfig(settings))}
            onClose={closeSettings}
          />
        );
      case 'Volumen de Respuesta':
        return (
          <ResponseVolumeSettings
            symbol={symbol}
            indicator={current.getResponseVolumeIndicator()}
            onApply={(settings) => applyHere(m => m.getResponseVolumeIndicator().updateConfig(settings))}
            onClose={closeSettings}
          />
        );
      case 'Liquidaciones':
        return (
          <LiquidationsSettings
            symbol={symbol}
            indicator={current.getLiquidationsIndicator()}
            onApply={(settings) => applyHere(m => m.getLiquidationsIndicator().updateConfig(settings))}
            onClose={closeSettings}
          />
        );
      default:
        return null;
    }
  };

  const enabledCount = INDICATORS.filter(name => indicatorStates[name]).length;

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="suite-bar" style={{ height: 36 }}>
        <select className="suite-select" value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Moneda">
          {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 2 }}>
          {TIMEFRAMES.map(tf => (
            <button key={tf} type="button" className={`suite-btn ${tf === timeframe ? 'active' : ''}`} onClick={() => setTimeframe(tf)}>
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative' }}>
          <button type="button" className="suite-btn" onClick={() => setShowList(open => !open)}>Indicadores {enabledCount}</button>
          {showList && (
            <div className="suite-menu">
              {INDICATORS.map(name => (
                <div key={name} className="suite-menu-row">
                  <label>
                    <input type="checkbox" checked={!!indicatorStates[name]} onChange={() => toggle(name)} style={{ marginRight: 8 }} />
                    {name}
                  </label>
                  {WITH_SETTINGS.has(name) && (
                    <button
                      type="button"
                      title={`Ajustes de ${name}`}
                      onClick={() => { setShowList(false); setSettingsFor(name); }}
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}
                    >
                      ⚙️
                    </button>
                  )}
                </div>
              ))}
              <div style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}>
                Los footprints llegan hasta el último minuto guardado del almacén (cerca de 1 minuto atrás).
              </div>
            </div>
          )}
        </div>
        <span className="suite-spacer" />
        <span style={{ fontSize: 11, opacity: 0.7 }}>En vivo · Bybit</span>
      </div>
      <div className="backtesting-main" style={{ flex: 1, position: 'relative', minHeight: 0 }} onMouseDown={() => setShowList(false)}>
        <div className="timeframe-panel" style={{ position: 'absolute', inset: 0 }}>
          <MiniChart
            ref={chartRef}
            key={`${symbol}-${timeframe}`}
            symbol={symbol}
            interval={timeframe}
            days={DAYS[timeframe]}
            isActive={active}
            indicatorStates={indicatorStates}
            backtestingMode={false}
            vpConfig={vpConfig}
            vpFixedRange={vpFixedRange}
            oiMode="histogram"
            currentTool={currentTool}
            onToolChange={setCurrentTool}
            getTradeBoundaries={noTrades}
            onRequestPause={noop}
            onRequestTimeChange={noop}
            onDrawingsChange={noop}
          />
        </div>
      </div>
      {settingsFor && renderSettings()}
    </div>
  );
}
