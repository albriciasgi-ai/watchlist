// src/components/SingleSymbolAnalyzer.jsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import MiniChart from "./MiniChart";
import SymbolSelector from "./SymbolSelector";
import SymbolList from "./SymbolList";
import VolumeProfileSettings from "./VolumeProfileSettings";
import RangeDetectionSettings from "./RangeDetectionSettings";
import RejectionPatternSettings from "./RejectionPatternSettings";
import DoubleTopBottomSettings from "./DoubleTopBottomSettings";
import SwingDetectorSettings from "./SwingDetectorSettings";
import SupportResistanceSettings from "./SupportResistanceSettings";
import VWAPSettings from "./VWAPSettings";
import FibonacciSettings from "./FibonacciSettings";
import ContinuationPatternSettings from "./ContinuationPatternSettings";
import wsManager from "./WebSocketManager";
import { SlidingAlertPanel, AlertPanelToggle } from "./SlidingAlertPanel";
import { useGlobalAlerts } from "../hooks/useGlobalAlerts";
import PresetManager from "../utils/PresetManager";
import IndicatorManagerRegistry from "../utils/IndicatorManagerRegistry";
import Logger from '../utils/Logger.js';
import { API_BASE_URL } from "../config";

const log = new Logger('SingleSymbolAnalyzer', { level: 'info' });

// Lista de simbolos disponibles para autocompletado
const AVAILABLE_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "XRPUSDT", "TRXUSDT", "GALAUSDT",
  "SUIUSDT", "TRBUSDT", "SOLUSDT", "ADAUSDT", "DOGEUSDT",
  "LINKUSDT", "BNBUSDT", "AVAXUSDT", "MATICUSDT", "DOTUSDT",
  "LTCUSDT", "ATOMUSDT", "NEARUSDT", "APTUSDT", "ARBUSDT",
  "OPUSDT", "INJUSDT", "SEIUSDT", "TIAUSDT", "JUPUSDT",
  "WIFUSDT", "PEPEUSDT", "BONKUSDT", "FLOKIUSDT", "SHIBUSDT"
];

// Dias por defecto por timeframe
const DEFAULT_DAYS_BY_INTERVAL = {
  "1": 1,
  "5": 5,
  "15": 15,
  "60": 90,
  "240": 300,
  "D": 730,
  "W": 730
};

// Limites maximos de dias por timeframe
const MAX_DAYS_BY_INTERVAL = {
  "1": 5,
  "5": 30,
  "15": 90,
  "30": 150,
  "60": 360,
  "240": 720,
  "D": 1440,
  "W": 730
};

// Opciones de dias por timeframe
const DAYS_OPTIONS_BY_INTERVAL = {
  "1": [1, 2, 3, 4, 5],
  "5": [1, 2, 5, 7, 10, 15, 20, 30],
  "15": [1, 2, 5, 7, 10, 15, 30, 60, 90],
  "30": [1, 2, 5, 7, 10, 15, 30, 60, 90, 120, 150],
  "60": [1, 2, 5, 7, 10, 15, 30, 60, 90, 120, 180, 270, 360],
  "240": [1, 2, 5, 7, 10, 15, 30, 60, 90, 180, 270, 360, 540, 720],
  "D": [30, 60, 90, 180, 270, 365, 540, 720, 1080, 1440],
  "W": [90, 180, 365, 730]
};

const SingleSymbolAnalyzer = () => {
  // Estado principal: UN solo simbolo
  const [symbol, setSymbol] = useState(() => {
    const saved = localStorage.getItem('analyzer_current_symbol');
    return saved || "BTCUSDT";
  });

  const [interval, setInterval] = useState(() => {
    const saved = localStorage.getItem('analyzer_interval');
    return saved || "60";
  });

  const [days, setDays] = useState(() => {
    const saved = localStorage.getItem('analyzer_days');
    return saved || "1";
  });

  const [indicatorStates, setIndicatorStates] = useState(() => {
    const saved = localStorage.getItem('analyzer_indicators');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        log.error('Error parsing saved indicators:', e);
      }
    }
    return {
      "Volume Delta": false,
      "CVD": false,
      "Volume Profile": false,
      "Open Interest": false,
      "VWAP": true,
      "Fibonacci": false,
      "Continuation Patterns": false,
      "Rejection Patterns": false,
      "Double Top/Bottom": false,
      "Support & Resistance": true,
      "Swing Detector": true
    };
  });

  // Panel de alertas
  const [isAlertPanelOpen, setIsAlertPanelOpen] = useState(false);
  const { alertCount } = useGlobalAlerts();

  // Configuracion de Volume Profile
  const [vpConfig, setVpConfig] = useState({
    mode: "dynamic",
    rows: 100,
    valueAreaPercent: 0.70,
    histogramWidth: 50,
    histogramPosition: "right",
    useGradient: true,
    showLabels: true,
    showVolumeLabels: false,
    hideWhenFixedRanges: false,
    baseColor: "#2196F3",
    valueAreaColor: "#FF9800",
    pocColor: "#F44336",
    vahValColor: "#2196F3",
    clusterColor: "#9C27B0",
    rangeShadeColor: "#E0E0E0",
    enableClusterDetection: false,
    clusterThreshold: 1.5
  });

  const [vpFixedRange, setVpFixedRange] = useState(null);
  const [showVpSettings, setShowVpSettings] = useState(false);
  const [oiMode, setOiMode] = useState("histogram");

  // Estados para Settings modals
  const [showRangeDetectionSettings, setShowRangeDetectionSettings] = useState(false);
  const [showRejectionPatternSettings, setShowRejectionPatternSettings] = useState(false);
  const [showSupportResistanceSettings, setShowSupportResistanceSettings] = useState(false);
  const [showVWAPSettings, setShowVWAPSettings] = useState(false);
  const [showFibonacciSettings, setShowFibonacciSettings] = useState(false);
  const [showContinuationPatternSettings, setShowContinuationPatternSettings] = useState(false);
  const [showDoubleTopBottomSettings, setShowDoubleTopBottomSettings] = useState(false);
  const [showSwingDetectorSettings, setShowSwingDetectorSettings] = useState(false);

  // Ref para el indicatorManager actual (recibido desde MiniChart)
  const indicatorManagerRef = useRef(null);
  const currentCandlesRef = useRef(null);
  const [rejectionPatternConfig, setRejectionPatternConfig] = useState({});

  // Estado de fullscreen
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Estado de carga
  const [isDTBReloading, setIsDTBReloading] = useState(false);

  // Ref para el chart key (forzar remount al cambiar simbolo)
  const chartKeyRef = useRef(0);

  // Guardar preferencias en localStorage
  useEffect(() => {
    localStorage.setItem('analyzer_current_symbol', symbol);
  }, [symbol]);

  useEffect(() => {
    localStorage.setItem('analyzer_interval', interval);
  }, [interval]);

  useEffect(() => {
    localStorage.setItem('analyzer_days', days);
  }, [days]);

  useEffect(() => {
    localStorage.setItem('analyzer_indicators', JSON.stringify(indicatorStates));
  }, [indicatorStates]);

  // Ajustar dias al cambiar timeframe
  useEffect(() => {
    const defaultDays = DEFAULT_DAYS_BY_INTERVAL[interval];
    const maxDays = MAX_DAYS_BY_INTERVAL[interval] || 30;
    const currentDays = parseInt(days);

    if (defaultDays) {
      setDays(defaultDays.toString());
      log.debug(`Dias ajustados a ${defaultDays} para timeframe ${interval}`);
    } else if (currentDays > maxDays) {
      setDays(maxDays.toString());
    }
  }, [interval]);

  // Cambiar intervalo en WebSocket manager
  useEffect(() => {
    wsManager.changeInterval(interval);
  }, [interval]);

  // Sincronizar Swing Detector con backend
  useEffect(() => {
    const syncSwingDetector = async () => {
      if (!indicatorStates["Swing Detector"]) return;

      try {
        log.debug(`Sincronizando Swing Detector: interval=${interval}, days=${days}`);
        const response = await fetch(`${API_BASE_URL}/api/swing/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            interval: interval,
            days: parseInt(days)
          })
        });

        if (response.ok) {
          log.debug('Swing Detector sincronizado');
        }
      } catch (error) {
        log.error('Error sincronizando Swing Detector:', error);
      }
    };

    syncSwingDetector();
  }, [interval, days, indicatorStates["Swing Detector"]]);

  // Notificar backend del timeframe activo
  useEffect(() => {
    const notifyBackendTimeframe = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/realtime/set-interval`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ interval: interval })
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            log.info(`Backend monitoring interval: ${interval}`);
          }
        }
      } catch (error) {
        log.debug(`Could not notify backend: ${error.message}`);
      }
    };

    notifyBackendTimeframe();
  }, [interval]);

  // Handler para cambio de simbolo
  const handleSymbolChange = useCallback((newSymbol) => {
    if (newSymbol !== symbol) {
      log.info(`Cambiando simbolo: ${symbol} -> ${newSymbol}`);
      chartKeyRef.current += 1; // Forzar remount del chart
      setSymbol(newSymbol);
      indicatorManagerRef.current = null;
      currentCandlesRef.current = null;
    }
  }, [symbol]);

  const toggleIndicator = (indicatorName) => {
    setIndicatorStates(prev => ({
      ...prev,
      [indicatorName]: !prev[indicatorName]
    }));
  };

  // Handlers para Volume Profile
  const handleVpConfigChange = (newConfig) => {
    setVpConfig(newConfig);
  };

  const handleVpFixedRangeChange = (startTimestamp, endTimestamp) => {
    setVpFixedRange({
      start: startTimestamp,
      end: endTimestamp,
      applyToAll: false,
      symbol: symbol
    });
  };

  // Handlers para abrir Settings modals - reciben el indicatorManager desde MiniChart
  const handleOpenRangeDetectionSettings = useCallback((manager, candles) => {
    if (manager) {
      indicatorManagerRef.current = manager;
      currentCandlesRef.current = candles;
    }
    setShowRangeDetectionSettings(true);
  }, []);

  const handleOpenRejectionPatternSettings = useCallback((manager) => {
    if (manager) {
      indicatorManagerRef.current = manager;
    }
    setShowRejectionPatternSettings(true);
  }, []);

  const handleOpenSupportResistanceSettings = useCallback((manager) => {
    if (manager) {
      indicatorManagerRef.current = manager;
    }
    setShowSupportResistanceSettings(true);
  }, []);

  const handleOpenVWAPSettings = useCallback((manager) => {
    if (manager) {
      indicatorManagerRef.current = manager;
    }
    setShowVWAPSettings(true);
  }, []);

  const handleOpenFibonacciSettings = useCallback((manager) => {
    if (manager) {
      indicatorManagerRef.current = manager;
    }
    setShowFibonacciSettings(true);
  }, []);

  const handleOpenContinuationPatternSettings = useCallback((manager) => {
    if (manager) {
      indicatorManagerRef.current = manager;
    }
    setShowContinuationPatternSettings(true);
  }, []);

  const handleOpenDoubleTopBottomSettings = useCallback((manager) => {
    if (manager) {
      indicatorManagerRef.current = manager;
    }
    setShowDoubleTopBottomSettings(true);
  }, []);

  const handleOpenSwingDetectorSettings = useCallback((manager) => {
    if (manager) {
      indicatorManagerRef.current = manager;
    }
    setShowSwingDetectorSettings(true);
  }, []);

  // Handlers de cambio de configuracion
  const handleVWAPConfigChange = useCallback((config) => {
    const manager = indicatorManagerRef.current;
    if (manager) {
      const vwapIndicator = manager.getVWAPIndicator?.();
      if (vwapIndicator) {
        vwapIndicator.updateConfig(config);
        log.debug(`Updated VWAP config for ${symbol}`);
        PresetManager.updateSymbolOverride(symbol, "VWAP", config);
      }
    }
  }, [symbol]);

  const handleFibonacciConfigChange = useCallback((config) => {
    const manager = indicatorManagerRef.current;
    if (manager) {
      const fibIndicator = manager.getFibonacciIndicator?.();
      if (fibIndicator) {
        fibIndicator.updateConfig(config);
        log.debug(`Updated Fibonacci config for ${symbol}`);
        PresetManager.updateSymbolOverride(symbol, "Fibonacci", config);
      }
    }
  }, [symbol]);

  const handleContinuationPatternConfigChange = useCallback((config) => {
    const manager = indicatorManagerRef.current;
    if (manager) {
      const cpIndicator = manager.getContinuationPatternIndicator?.();
      if (cpIndicator) {
        cpIndicator.updateConfig(config);
        PresetManager.updateSymbolOverride(symbol, "Continuation Patterns", config);
      }
    }
  }, [symbol]);

  const handleDoubleTopBottomConfigChange = useCallback(async (config) => {
    const manager = indicatorManagerRef.current;
    if (manager) {
      const dtbIndicator = manager.indicators?.find(ind => ind.name === "Double Top/Bottom");
      if (dtbIndicator) {
        dtbIndicator.updateConfig(config);
        log.debug(`Updated Double Top/Bottom config for ${symbol}`);

        if (dtbIndicator.enabled) {
          setIsDTBReloading(true);
          try {
            await dtbIndicator.fetchData(manager.allCandles);
            if (manager.requestRedraw) {
              manager.requestRedraw();
            }
          } catch (error) {
            log.error('Error reloading DTB patterns:', error);
          } finally {
            setIsDTBReloading(false);
          }
        }
      }
    }
  }, [symbol]);

  const handleRejectionPatternConfigChange = useCallback((config) => {
    setRejectionPatternConfig(config);
    const manager = indicatorManagerRef.current;
    if (manager) {
      manager.updateRejectionPatternConfig?.(config);
      log.debug(`Updated rejection pattern config for ${symbol}`);
      PresetManager.updateSymbolOverride(symbol, "Rejection Patterns", config);
    }
  }, [symbol]);

  const handleSupportResistanceConfigChange = useCallback((config) => {
    const manager = indicatorManagerRef.current;
    if (manager) {
      const srIndicator = manager.getSupportResistanceIndicator?.();
      if (srIndicator) {
        srIndicator.updateConfig(config);
        log.debug(`Updated Support & Resistance config for ${symbol}`);
        PresetManager.updateSymbolOverride(symbol, "Support & Resistance", config);
      }
    }
  }, [symbol]);

  const handleRangeDetectionConfigChange = useCallback((config) => {
    const manager = indicatorManagerRef.current;
    if (manager) {
      const rdIndicator = manager.getRangeDetector?.();
      if (rdIndicator) {
        rdIndicator.updateConfig(config);
        log.debug(`Updated Range Detection config for ${symbol}`);
        PresetManager.updateSymbolOverride(symbol, "Range Detection", config);
      }
    }
  }, [symbol]);

  const handleFullscreenChange = useCallback((sym, chartInterval, fullscreen) => {
    setIsFullscreen(fullscreen);
  }, []);

  const getAvailableDaysOptions = () => {
    return DAYS_OPTIONS_BY_INTERVAL[interval] || [1, 2, 5, 10, 30];
  };

  // Helper para obtener config de indicador
  const getIndicatorConfig = (getterName) => {
    const manager = indicatorManagerRef.current;
    if (!manager) return null;
    const getter = manager[getterName];
    if (typeof getter === 'function') {
      return getter.call(manager);
    }
    return null;
  };

  return (
    <div className="analyzer-container">
      {/* Banner de recarga DTB */}
      {isDTBReloading && (
        <div style={{
          position: 'fixed',
          top: '60px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'linear-gradient(135deg, #FF9800 0%, #F57C00 100%)',
          color: 'white',
          padding: '12px 24px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 10000,
          fontSize: '14px',
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{
            width: '16px',
            height: '16px',
            border: '2px solid rgba(255,255,255,0.3)',
            borderTop: '2px solid white',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite'
          }}></div>
          Recargando patrones Double Top/Bottom para {symbol}...
        </div>
      )}

      {/* Header */}
      <div className="watchlist-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <h2 style={{ margin: 0 }}>Analizador Cripto</h2>
          <SymbolSelector
            value={symbol}
            onChange={handleSymbolChange}
            symbols={AVAILABLE_SYMBOLS}
          />
        </div>

        <div className="controls">
          <label>
            Timeframe:
            <select value={interval} onChange={(e) => setInterval(e.target.value)}>
              <option value="1">1m</option>
              <option value="5">5m</option>
              <option value="15">15m</option>
              <option value="30">30m</option>
              <option value="60">1h</option>
              <option value="240">4h</option>
              <option value="D">1D</option>
              <option value="W">1W</option>
            </select>
          </label>

          <label>
            Dias (max: {MAX_DAYS_BY_INTERVAL[interval] || 30}):
            <select value={days} onChange={(e) => setDays(e.target.value)}>
              {getAvailableDaysOptions().map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>

          <AlertPanelToggle
            isOpen={isAlertPanelOpen}
            onClick={() => setIsAlertPanelOpen(!isAlertPanelOpen)}
            alertCount={alertCount}
          />
        </div>
      </div>

      {/* Indicadores toggles */}
      <div className="indicator-toggles">
        {Object.keys(indicatorStates).map(name => (
          <label key={name}>
            <input
              type="checkbox"
              checked={indicatorStates[name]}
              onChange={() => toggleIndicator(name)}
            />
            {name}
          </label>
        ))}

        {indicatorStates["Volume Profile"] && (
          <button
            onClick={() => setShowVpSettings(true)}
            className="vp-settings-btn"
            title="Configurar Volume Profile"
          >
            VP Config
          </button>
        )}
      </div>

      {/* Contenedor principal: Chart + Lista de simbolos */}
      <div className="main-content">
        {/* Chart principal */}
        <div className="chart-area">
          <MiniChart
            key={`${symbol}-${chartKeyRef.current}`}
            symbol={symbol}
            interval={interval}
            days={days}
            indicatorStates={indicatorStates}
            vpConfig={vpConfig}
            vpFixedRange={vpFixedRange}
            oiMode={oiMode}
            onOpenVpSettings={() => setShowVpSettings(true)}
            onOpenRangeDetectionSettings={handleOpenRangeDetectionSettings}
            onOpenRejectionPatternSettings={handleOpenRejectionPatternSettings}
            onOpenSupportResistanceSettings={handleOpenSupportResistanceSettings}
            onOpenVWAPSettings={handleOpenVWAPSettings}
            onOpenFibonacciSettings={handleOpenFibonacciSettings}
            onOpenContinuationPatternSettings={handleOpenContinuationPatternSettings}
            onOpenDoubleTopBottomSettings={handleOpenDoubleTopBottomSettings}
            onOpenSwingDetectorSettings={handleOpenSwingDetectorSettings}
            rejectionPatternConfig={rejectionPatternConfig}
            onFullscreenChange={handleFullscreenChange}
            onChartLoaded={() => log.debug(`Chart loaded: ${symbol}`)}
          />
        </div>

        {/* Lista de simbolos lateral */}
        <SymbolList
          currentSymbol={symbol}
          onSymbolSelect={handleSymbolChange}
          interval={interval}
          days={parseInt(days)}
        />
      </div>

      {/* Panel de alertas */}
      <SlidingAlertPanel
        isOpen={isAlertPanelOpen}
        onClose={() => setIsAlertPanelOpen(false)}
        symbol={symbol}
        interval={interval}
      />

      {/* Modals de configuracion */}
      {showVpSettings && (
        <div className="modal-overlay" onClick={() => setShowVpSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Configuracion Volume Profile</h3>
              <button className="modal-close-btn" onClick={() => setShowVpSettings(false)}>X</button>
            </div>
            <div className="modal-body">
              <VolumeProfileSettings
                config={vpConfig}
                onConfigChange={handleVpConfigChange}
                onFixedRangeChange={handleVpFixedRangeChange}
                applyToAll={false}
                onApplyToAllChange={() => {}}
                currentSymbol={symbol}
              />
            </div>
          </div>
        </div>
      )}

      {showRangeDetectionSettings && (
        <div className="modal-overlay" onClick={() => setShowRangeDetectionSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <RangeDetectionSettings
              symbol={symbol}
              indicatorManager={indicatorManagerRef.current}
              candles={currentCandlesRef.current}
              onConfigChange={handleRangeDetectionConfigChange}
              onClose={() => setShowRangeDetectionSettings(false)}
            />
          </div>
        </div>
      )}

      {showRejectionPatternSettings && (
        <RejectionPatternSettings
          symbol={symbol}
          indicatorManager={indicatorManagerRef.current}
          onConfigChange={handleRejectionPatternConfigChange}
          onClose={() => setShowRejectionPatternSettings(false)}
          initialConfig={rejectionPatternConfig}
        />
      )}

      {showSupportResistanceSettings && (
        <SupportResistanceSettings
          symbol={symbol}
          indicatorManager={indicatorManagerRef.current}
          onConfigChange={handleSupportResistanceConfigChange}
          onClose={() => setShowSupportResistanceSettings(false)}
        />
      )}

      {showVWAPSettings && (
        <div className="modal-overlay" onClick={() => setShowVWAPSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Configuracion VWAP - {symbol}</h3>
              <button className="modal-close-btn" onClick={() => setShowVWAPSettings(false)}>X</button>
            </div>
            <div className="modal-body">
              <VWAPSettings
                config={(() => {
                  const vwapIndicator = getIndicatorConfig('getVWAPIndicator');
                  return vwapIndicator ? {
                    vwapType: vwapIndicator.vwapType,
                    resetHour: vwapIndicator.resetHour,
                    rollingPeriod: vwapIndicator.rollingPeriod,
                    showBands: vwapIndicator.showBands,
                    applyCryptoAdjustment: vwapIndicator.applyCryptoAdjustment,
                    bandMultipliers: vwapIndicator.bandMultipliers,
                    vwapColor: vwapIndicator.vwapColor
                  } : {
                    vwapType: 'session',
                    resetHour: 0,
                    rollingPeriod: 20,
                    showBands: true,
                    applyCryptoAdjustment: true,
                    bandMultipliers: [1.0, 2.0, 3.0],
                    vwapColor: '#FF9800'
                  };
                })()}
                onConfigChange={handleVWAPConfigChange}
                currentSymbol={symbol}
                interval={interval}
              />
            </div>
          </div>
        </div>
      )}

      {showFibonacciSettings && (
        <div className="modal-overlay" onClick={() => setShowFibonacciSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Configuracion Fibonacci - {symbol}</h3>
              <button className="modal-close-btn" onClick={() => setShowFibonacciSettings(false)}>X</button>
            </div>
            <div className="modal-body">
              <FibonacciSettings
                config={(() => {
                  const fibIndicator = getIndicatorConfig('getFibonacciIndicator');
                  return fibIndicator ? {
                    autoDetect: fibIndicator.autoDetect,
                    lookback: fibIndicator.lookback,
                    showRetracements: fibIndicator.showRetracements,
                    showExtensions: fibIndicator.showExtensions,
                    levels: fibIndicator.levels,
                    extensionLevels: fibIndicator.extensionLevels,
                    color: fibIndicator.color,
                    labelPosition: fibIndicator.labelPosition,
                    lineWidth: fibIndicator.lineWidth
                  } : {
                    autoDetect: true,
                    lookback: 50,
                    showRetracements: true,
                    showExtensions: false,
                    levels: [0.236, 0.382, 0.5, 0.618, 0.786],
                    extensionLevels: [1.272, 1.414, 1.618, 2.0, 2.618],
                    color: 'rgba(33, 150, 243, 0.6)',
                    labelPosition: 'right',
                    lineWidth: 1
                  };
                })()}
                onConfigChange={handleFibonacciConfigChange}
                currentSymbol={symbol}
              />
            </div>
          </div>
        </div>
      )}

      {showContinuationPatternSettings && (
        <div className="modal-overlay" onClick={() => setShowContinuationPatternSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Continuation Patterns - {symbol}</h3>
              <button className="modal-close-btn" onClick={() => setShowContinuationPatternSettings(false)}>X</button>
            </div>
            <div className="modal-body">
              <ContinuationPatternSettings
                config={(() => {
                  const cpIndicator = getIndicatorConfig('getContinuationPatternIndicator');
                  return cpIndicator ? {
                    showContinuation: cpIndicator.showContinuation,
                    showTrendStart: cpIndicator.showTrendStart,
                    showMomentum: cpIndicator.showMomentum,
                    showReversal: cpIndicator.showReversal,
                    minConfidence: cpIndicator.minConfidence,
                    includeVWAP: cpIndicator.includeVWAP,
                    includeFibonacci: cpIndicator.includeFibonacci,
                    vwapConfig: cpIndicator.vwapConfig,
                    fibonacciConfig: cpIndicator.fibonacciConfig,
                    showLabels: cpIndicator.showLabels,
                    showConfidence: cpIndicator.showConfidence,
                    iconSize: cpIndicator.iconSize,
                    patternParams: cpIndicator.patternParams
                  } : null;
                })()}
                onConfigChange={handleContinuationPatternConfigChange}
                currentSymbol={symbol}
              />
            </div>
          </div>
        </div>
      )}

      {showDoubleTopBottomSettings && (
        <div className="modal-overlay" onClick={() => setShowDoubleTopBottomSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Double Top/Bottom - {symbol}</h3>
              <button className="modal-close-btn" onClick={() => setShowDoubleTopBottomSettings(false)}>X</button>
            </div>
            <div className="modal-body">
              <DoubleTopBottomSettings
                symbol={symbol}
                currentTimeframe={interval}
                onConfigChange={handleDoubleTopBottomConfigChange}
                onClose={() => setShowDoubleTopBottomSettings(false)}
                indicator={indicatorManagerRef.current?.indicators?.find(ind => ind.name === "Double Top/Bottom")}
                initialConfig={indicatorManagerRef.current?.indicators?.find(ind => ind.name === "Double Top/Bottom")?.config}
              />
            </div>
          </div>
        </div>
      )}

      {showSwingDetectorSettings && (
        <div className="modal-overlay" onClick={() => setShowSwingDetectorSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Swing Detector - {symbol}</h3>
              <button className="modal-close-btn" onClick={() => setShowSwingDetectorSettings(false)}>X</button>
            </div>
            <div className="modal-body">
              <SwingDetectorSettings
                currentSymbol={symbol}
                watchlistDays={parseInt(days)}
                watchlistInterval={interval}
                config={(() => {
                  const manager = indicatorManagerRef.current;
                  const sdIndicator = manager?.getSwingDetectorIndicator?.();
                  return sdIndicator?.config || { enabled: true, arrowSize: 10, longColor: '#00E676', shortColor: '#FF1744' };
                })()}
                onConfigChange={(config) => {
                  const manager = indicatorManagerRef.current;
                  const sdIndicator = manager?.getSwingDetectorIndicator?.();
                  if (sdIndicator) {
                    sdIndicator.updateConfig(config);
                  }
                }}
                onBackendConfigSaved={async () => {
                  const manager = indicatorManagerRef.current;
                  const sdIndicator = manager?.getSwingDetectorIndicator?.();
                  if (sdIndicator) {
                    await sdIndicator.fetchSignals();
                    if (manager?.requestRedraw) {
                      manager.requestRedraw();
                    }
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SingleSymbolAnalyzer;
