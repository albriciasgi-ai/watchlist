// src/components/Watchlist.jsx
import React, { useState, useEffect } from "react";
import MiniChart from "./MiniChart";
import VolumeProfileSettings from "./VolumeProfileSettings";
import RangeDetectionSettings from "./RangeDetectionSettings";
import RejectionPatternSettings from "./RejectionPatternSettings";
import SupportResistanceSettings from "./SupportResistanceSettings";
import AlertPanel from "./AlertPanel";
import AlertConfigPanel from "./AlertConfigPanel";
import { AlertToastContainer } from "./AlertToast";
import wsManager from "./WebSocketManager";

const symbols = [
  "BTCUSDT", "ETHUSDT", "TRXUSDT", "XRPUSDT", "SOLUSDT", "AAVEUSDT",
  "GALAUSDT", "OPUSDT", "ADAUSDT", "SUIUSDT", "POLUSDT", "POLYXUSDT",
  "CAKEUSDT", "PENDLEUSDT", "TONUSDT", "UNIUSDT", "ARBUSDT", "DOTUSDT",
  "AVAXUSDT", "BNBUSDT", "PEOPLEUSDT", "HBARUSDT", "ASTRUSDT", "MASKUSDT",
  "TRBUSDT", "INJUSDT", "ATOMUSDT", "GRTUSDT",
  "ALGOUSDT"
];

// CORREGIDO: Límites máximos de días por timeframe (deben coincidir con el backend)
const MAX_DAYS_BY_INTERVAL = {
  "5": 5,
  "15": 15,
  "30": 30,
  "60": 120,
  "240": 300,
  "D": 730,
  "W": 730
};

// CORREGIDO: Opciones de días permitidas por timeframe
const DAYS_OPTIONS_BY_INTERVAL = {
  "5": [1, 2, 5],
  "15": [1, 2, 5, 10, 15],
  "30": [1, 2, 5, 10, 30],
  "60": [1, 2, 5, 10, 30, 60, 90, 120],
  "240": [1, 2, 5, 10, 30, 60, 90, 180, 300],
  "D": [30, 60, 90, 180, 365, 730],
  "W": [90, 180, 365, 730]
};

const Watchlist = () => {
  const [interval, setInterval] = useState("15");
  const [days, setDays] = useState("15");
  const [indicatorStates, setIndicatorStates] = useState({
    "Volume Delta": true,
    "CVD": true,
    "Volume Profile": false,
    "Open Interest": false
  });
  
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
  const [vpApplyToAll, setVpApplyToAll] = useState(true);
  const [showVpSettings, setShowVpSettings] = useState(false);
  const [selectedSymbolForVp, setSelectedSymbolForVp] = useState(null);

  // 🎯 NUEVO: Estado para Range Detection Settings
  const [showRangeDetectionSettings, setShowRangeDetectionSettings] = useState(false);
  const [selectedSymbolForRD, setSelectedSymbolForRD] = useState(null);
  const [indicatorManagers, setIndicatorManagers] = useState({});

  // 🔔 NUEVO: Estado para Rejection Pattern Settings
  const [showRejectionPatternSettings, setShowRejectionPatternSettings] = useState(false);
  const [selectedSymbolForRP, setSelectedSymbolForRP] = useState(null);
  const [rejectionPatternConfigs, setRejectionPatternConfigs] = useState({});

  // ⚡ NUEVO: Estado para Support/Resistance Settings
  const [showSRSettings, setShowSRSettings] = useState(false);
  const [selectedSymbolForSR, setSelectedSymbolForSR] = useState(null);
  const [srConfigs, setSRConfigs] = useState({});

  // 📊 NUEVO: Estado para Open Interest mode
  const [oiMode, setOiMode] = useState("histogram"); // "histogram", "cumulative", "flow"

  // 🔔 NUEVO: Sistema de Alertas Integrado
  const [alerts, setAlerts] = useState([]);
  const [toastAlerts, setToastAlerts] = useState([]);
  const [showAlertPanel, setShowAlertPanel] = useState(false);
  const [showAlertConfig, setShowAlertConfig] = useState(false);
  const [alertConfig, setAlertConfig] = useState({
    enabled: true,
    soundEnabled: false,
    browserNotifications: false,
    minSeverity: 'LOW', // 'LOW', 'MEDIUM', 'HIGH'
    enabledIndicators: {
      'Support & Resistance': true,
      'Rejection Patterns': true,
      'Volume Profile': false,
      'Open Interest': false
    },
    confluenceEnabled: true,
    minIndicatorsForConfluence: 2,
    confluenceWindowCandles: 3,
    confluencePriceProximity: 0.5
  });

  // CORREGIDO: Ajustar días al cambiar timeframe solo si excede el máximo
  useEffect(() => {
    const maxDays = MAX_DAYS_BY_INTERVAL[interval] || 30;
    const currentDays = parseInt(days);
    
    if (currentDays > maxDays) {
      // Si los días actuales exceden el máximo, ajustar al máximo permitido
      setDays(maxDays.toString());
      console.log(`[Watchlist] Días ajustados de ${currentDays} a ${maxDays} por límite de timeframe ${interval}`);
    }
    // IMPORTANTE: Si currentDays <= maxDays, NO ajustar (mantener la selección del usuario)
  }, [interval]); // Removido 'days' de las dependencias para evitar loops

  useEffect(() => {
    wsManager.changeInterval(interval);
  }, [interval]);

  const toggleIndicator = (indicatorName) => {
    setIndicatorStates(prev => ({
      ...prev,
      [indicatorName]: !prev[indicatorName]
    }));
  };

  const handleVpConfigChange = (newConfig) => {
    setVpConfig(newConfig);
  };

  const handleVpFixedRangeChange = (startTimestamp, endTimestamp) => {
    setVpFixedRange({
      start: startTimestamp,
      end: endTimestamp,
      applyToAll: vpApplyToAll,
      symbol: vpApplyToAll ? null : selectedSymbolForVp
    });
  };

  const handleOpenVpSettings = (symbol = null) => {
    setSelectedSymbolForVp(symbol);
    setShowVpSettings(true);
  };

  // 🎯 NUEVO: Handler para abrir Range Detection Settings
  const handleOpenRangeDetectionSettings = (symbol, indicatorManagerRef, candles) => {
    setSelectedSymbolForRD(symbol);

    // Guardar referencia del IndicatorManager y las velas
    if (indicatorManagerRef) {
      setIndicatorManagers(prev => ({
        ...prev,
        [symbol]: { manager: indicatorManagerRef, candles: candles }
      }));
    }

    setShowRangeDetectionSettings(true);
  };

  // 🔔 NUEVO: Handler para abrir Rejection Pattern Settings
  const handleOpenRejectionPatternSettings = (symbol, indicatorManagerRef) => {
    setSelectedSymbolForRP(symbol);

    // Guardar referencia del IndicatorManager
    if (indicatorManagerRef) {
      setIndicatorManagers(prev => ({
        ...prev,
        [symbol]: { ...prev[symbol], manager: indicatorManagerRef }
      }));
    }

    setShowRejectionPatternSettings(true);
  };

  // ⚡ NUEVO: Handler para abrir Support/Resistance Settings
  const handleOpenSRSettings = (symbol, indicatorManagerRef) => {
    setSelectedSymbolForSR(symbol);

    // Guardar referencia del IndicatorManager
    if (indicatorManagerRef) {
      setIndicatorManagers(prev => ({
        ...prev,
        [symbol]: { ...prev[symbol], manager: indicatorManagerRef }
      }));
    }

    setShowSRSettings(true);
  };

  // 🔔 NUEVO: Handler para cambio de config de patrones
  const handleRejectionPatternConfigChange = (config) => {
    setRejectionPatternConfigs(prev => ({
      ...prev,
      [selectedSymbolForRP]: config
    }));

    // Actualizar el IndicatorManager con la nueva configuración
    const manager = indicatorManagers[selectedSymbolForRP]?.manager;
    if (manager) {
      manager.updateRejectionPatternConfig(config);
      console.log(`[Watchlist] Updated rejection pattern config for ${selectedSymbolForRP}`);
    }
  };

  // ⚡ NUEVO: Handler para cambio de config de S/R
  const handleSRConfigChange = (config) => {
    setSRConfigs(prev => ({
      ...prev,
      [selectedSymbolForSR]: config
    }));

    // Actualizar el IndicatorManager con la nueva configuración
    const manager = indicatorManagers[selectedSymbolForSR]?.manager;
    if (manager) {
      manager.applyConfig("Support & Resistance", config);
      // Re-fetch data con nueva configuración
      const srIndicator = manager.indicators.find(ind => ind.name === "Support & Resistance");
      if (srIndicator) {
        srIndicator.fetchData();
      }
      console.log(`[Watchlist] Updated S/R config for ${selectedSymbolForSR}`);
    }
  };

  // 🔔 NUEVO: Sistema de Alertas - useEffect para cargar desde localStorage
  useEffect(() => {
    const savedAlerts = localStorage.getItem('watchlist_alerts');
    const savedAlertConfig = localStorage.getItem('watchlist_alert_config');

    if (savedAlerts) {
      try {
        const parsed = JSON.parse(savedAlerts);
        setAlerts(parsed);
      } catch (e) {
        console.error('[Watchlist] Error loading alerts:', e);
      }
    }

    if (savedAlertConfig) {
      try {
        const parsed = JSON.parse(savedAlertConfig);
        setAlertConfig(parsed);
      } catch (e) {
        console.error('[Watchlist] Error loading alert config:', e);
      }
    }
  }, []);

  // 🔔 NUEVO: Guardar alertas en localStorage cuando cambien
  useEffect(() => {
    localStorage.setItem('watchlist_alerts', JSON.stringify(alerts));
  }, [alerts]);

  // 🔔 NUEVO: Guardar configuración de alertas en localStorage
  useEffect(() => {
    localStorage.setItem('watchlist_alert_config', JSON.stringify(alertConfig));
  }, [alertConfig]);

  // 🔔 NUEVO: Agregar nueva alerta
  const addAlert = (alert) => {
    // Verificar si las alertas están habilitadas
    if (!alertConfig.enabled) return;

    // Verificar si el indicador está habilitado
    if (alert.indicatorType && !alertConfig.enabledIndicators[alert.indicatorType]) return;

    // Verificar severidad mínima
    const severityLevels = { 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3 };
    const minLevel = severityLevels[alertConfig.minSeverity] || 1;
    const alertLevel = severityLevels[alert.severity] || 1;
    if (alertLevel < minLevel) return;

    // Crear alerta con ID único
    const newAlert = {
      ...alert,
      id: Date.now() + Math.random(),
      timestamp: alert.timestamp || Date.now()
    };

    // Agregar a alertas
    setAlerts(prev => [newAlert, ...prev].slice(0, 100)); // Mantener solo últimas 100

    // Mostrar toast notification
    setToastAlerts(prev => [...prev, newAlert]);

    console.log('[Watchlist] Alert added:', newAlert);
  };

  // 🔔 NUEVO: Eliminar toast
  const dismissToast = (toastId) => {
    setToastAlerts(prev => prev.filter(t => (t.id || t.timestamp) !== toastId));
  };

  // 🔔 NUEVO: Eliminar alerta específica
  const deleteAlert = (alertId) => {
    setAlerts(prev => prev.filter(a => a.id !== alertId));
  };

  // 🔔 NUEVO: Limpiar todas las alertas
  const clearAllAlerts = () => {
    if (window.confirm('¿Estás seguro de que quieres borrar todas las alertas?')) {
      setAlerts([]);
      setToastAlerts([]);
    }
  };

  // Exponer función addAlert globalmente para que los indicadores puedan usarla
  useEffect(() => {
    window.addWatchlistAlert = addAlert;
    return () => {
      delete window.addWatchlistAlert;
    };
  }, [alertConfig]); // Re-crear cuando cambie la configuración

  // Obtener opciones de días disponibles según el timeframe actual
  const getAvailableDaysOptions = () => {
    return DAYS_OPTIONS_BY_INTERVAL[interval] || [1, 2, 5, 10, 30];
  };

  return (
    <div className="watchlist-container">
      <div className="watchlist-header">
        <h2>Watchlist PoC - Phase 3: Volume Profile + UI Controls</h2>

        <div className="controls">
          <label>
            Timeframe:
            <select value={interval} onChange={(e) => setInterval(e.target.value)}>
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
            Días (máx: {MAX_DAYS_BY_INTERVAL[interval] || 30}):
            <select value={days} onChange={(e) => setDays(e.target.value)}>
              {getAvailableDaysOptions().map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>

          <div className="indicator-toggles">
            <label>
              <input 
                type="checkbox" 
                checked={indicatorStates["Volume Delta"]}
                onChange={() => toggleIndicator("Volume Delta")}
              />
              Volume Delta
            </label>
            
            <label>
              <input 
                type="checkbox" 
                checked={indicatorStates["CVD"]}
                onChange={() => toggleIndicator("CVD")}
              />
              CVD
            </label>

            <label>
              <input
                type="checkbox"
                checked={indicatorStates["Volume Profile"]}
                onChange={() => toggleIndicator("Volume Profile")}
              />
              Volume Profile
            </label>

            {indicatorStates["Volume Profile"] && (
              <button
                onClick={() => handleOpenVpSettings(null)}
                className="vp-settings-btn"
                title="Configurar Volume Profile"
              >
                ⚙ Config VP
              </button>
            )}

            <label>
              <input
                type="checkbox"
                checked={indicatorStates["Open Interest"]}
                onChange={() => toggleIndicator("Open Interest")}
              />
              Open Interest
            </label>

            {indicatorStates["Open Interest"] && (
              <select
                value={oiMode}
                onChange={(e) => setOiMode(e.target.value)}
                style={{
                  marginLeft: "5px",
                  padding: "2px 5px",
                  fontSize: "11px",
                  border: "1px solid #DDD",
                  borderRadius: "3px"
                }}
              >
                <option value="histogram">Histogram</option>
                <option value="cumulative">Cumulative</option>
                <option value="flow">Flow</option>
              </select>
            )}

            {/* 🔔 NUEVO: Botón de Alertas */}
            <button
              onClick={() => setShowAlertPanel(true)}
              style={{
                marginLeft: '16px',
                padding: '6px 12px',
                background: alerts.length > 0 ? '#ff9800' : '#4a9eff',
                color: 'white',
                border: 'none',
                borderRadius: '4px 0 0 4px',
                borderRight: '1px solid rgba(255,255,255,0.2)',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
              title="Ver historial de alertas"
            >
              🔔 Alerts
              {alerts.length > 0 && (
                <span style={{
                  background: 'rgba(255,255,255,0.3)',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  fontSize: '11px'
                }}>
                  {alerts.length}
                </span>
              )}
            </button>

            {/* ⚙️ NUEVO: Botón de Configuración de Alertas */}
            <button
              onClick={() => setShowAlertConfig(true)}
              style={{
                padding: '6px 10px',
                background: '#4a9eff',
                color: 'white',
                border: 'none',
                borderRadius: '0 4px 4px 0',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 'bold'
              }}
              title="Configurar sistema de alertas"
            >
              ⚙️
            </button>

            {/* 🧪 NUEVO: Botón de Prueba de Alertas (solo para testing) */}
            <button
              onClick={() => {
                const testSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
                const testTypes = ['Support', 'Resistance'];
                const testSeverities = ['HIGH', 'MEDIUM', 'LOW'];

                const randomSymbol = testSymbols[Math.floor(Math.random() * testSymbols.length)];
                const randomType = testTypes[Math.floor(Math.random() * testTypes.length)];
                const randomSeverity = testSeverities[Math.floor(Math.random() * testSeverities.length)];
                const randomPrice = (Math.random() * 50000 + 20000).toFixed(2);
                const randomLevel = (parseFloat(randomPrice) * (1 + (Math.random() - 0.5) * 0.01)).toFixed(2);

                addAlert({
                  indicatorType: 'Support & Resistance',
                  severity: randomSeverity,
                  icon: randomType === 'Support' ? '🟢' : '🔴',
                  title: `${randomSymbol} approaching ${randomType}`,
                  symbol: randomSymbol,
                  interval: interval,
                  type: 'S/R Level',
                  description: `Price $${randomPrice} is near ${randomType.toLowerCase()} level at $${randomLevel}\nThis is a test alert`,
                  data: {
                    price: parseFloat(randomPrice),
                    levelPrice: parseFloat(randomLevel),
                    levelType: randomType.toLowerCase(),
                    strength: Math.random() * 10,
                    touches: Math.floor(Math.random() * 10) + 1,
                    distance: Math.random() * 0.5
                  }
                });
              }}
              style={{
                marginLeft: '8px',
                padding: '6px 12px',
                background: '#9C27B0',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 'bold'
              }}
              title="Generar alerta de prueba"
            >
              🧪 Test Alert
            </button>
          </div>
        </div>
      </div>

      <div className="grid-container">
        {symbols.map((sym) => (
          <MiniChart
            key={sym}
            symbol={sym}
            interval={interval}
            days={days}
            indicatorStates={indicatorStates}
            vpConfig={vpConfig}
            vpFixedRange={vpFixedRange}
            oiMode={oiMode}
            onOpenVpSettings={() => handleOpenVpSettings(sym)}
            onOpenRangeDetectionSettings={(indicatorManagerRef, candles) => handleOpenRangeDetectionSettings(sym, indicatorManagerRef, candles)}
            onOpenRejectionPatternSettings={(indicatorManagerRef) => handleOpenRejectionPatternSettings(sym, indicatorManagerRef)}
            onOpenSRSettings={(indicatorManagerRef) => handleOpenSRSettings(sym, indicatorManagerRef)}
            rejectionPatternConfig={rejectionPatternConfigs[sym]}
            srConfig={srConfigs[sym]}
          />
        ))}
      </div>

      {showVpSettings && (
        <div className="modal-overlay" onClick={() => setShowVpSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Configuración Volume Profile</h3>
              <button 
                className="modal-close-btn"
                onClick={() => setShowVpSettings(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <VolumeProfileSettings
                config={vpConfig}
                onConfigChange={handleVpConfigChange}
                onFixedRangeChange={handleVpFixedRangeChange}
                applyToAll={vpApplyToAll}
                onApplyToAllChange={setVpApplyToAll}
                currentSymbol={selectedSymbolForVp || "TODAS"}
              />
            </div>
          </div>
        </div>
      )}

      {/* 🎯 NUEVO: Modal de Range Detection Settings */}
      {showRangeDetectionSettings && selectedSymbolForRD && (
        <div className="modal-overlay" onClick={() => setShowRangeDetectionSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <RangeDetectionSettings
              symbol={selectedSymbolForRD}
              indicatorManager={indicatorManagers[selectedSymbolForRD]?.manager}
              candles={indicatorManagers[selectedSymbolForRD]?.candles}
              onClose={() => {
                setShowRangeDetectionSettings(false);
                setSelectedSymbolForRD(null);
              }}
            />
          </div>
        </div>
      )}

      {/* 🔔 NUEVO: Modal de Rejection Pattern Settings */}
      {showRejectionPatternSettings && selectedSymbolForRP && (
        <RejectionPatternSettings
          symbol={selectedSymbolForRP}
          indicatorManager={indicatorManagers[selectedSymbolForRP]?.manager}
          onConfigChange={handleRejectionPatternConfigChange}
          onClose={() => {
            setShowRejectionPatternSettings(false);
            setSelectedSymbolForRP(null);
          }}
          initialConfig={rejectionPatternConfigs[selectedSymbolForRP]}
        />
      )}

      {/* ⚡ NUEVO: Modal de Support/Resistance Settings */}
      {showSRSettings && selectedSymbolForSR && (
        <SupportResistanceSettings
          symbol={selectedSymbolForSR}
          onConfigChange={handleSRConfigChange}
          onClose={() => {
            setShowSRSettings(false);
            setSelectedSymbolForSR(null);
          }}
          initialConfig={srConfigs[selectedSymbolForSR]}
        />
      )}

      {/* 🔔 NUEVO: Alert Panel */}
      {showAlertPanel && (
        <AlertPanel
          alerts={alerts}
          onClose={() => setShowAlertPanel(false)}
          onClearAlerts={clearAllAlerts}
          onDeleteAlert={deleteAlert}
        />
      )}

      {/* ⚙️ NUEVO: Alert Configuration Panel */}
      {showAlertConfig && (
        <AlertConfigPanel
          config={alertConfig}
          onConfigChange={(newConfig) => {
            setAlertConfig(newConfig);
            console.log('[Watchlist] Alert config updated:', newConfig);
          }}
          onClose={() => setShowAlertConfig(false)}
        />
      )}

      {/* 🔔 NUEVO: Toast Notifications */}
      <AlertToastContainer
        alerts={toastAlerts}
        onDismiss={dismissToast}
      />
    </div>
  );
};

export default Watchlist;