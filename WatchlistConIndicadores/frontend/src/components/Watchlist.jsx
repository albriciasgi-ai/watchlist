// src/components/Watchlist.jsx
import React, { useState, useEffect } from "react";
import MiniChart from "./MiniChart";
import VolumeProfileSettings from "./VolumeProfileSettings";
import RangeDetectionSettings from "./RangeDetectionSettings";
import RejectionPatternSettings from "./RejectionPatternSettings";
import SupportResistanceSettings from "./SupportResistanceSettings";
import wsManager from "./WebSocketManager";
import ProximityAlertDashboard from "./ProximityAlerts/ProximityAlertDashboard";

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

  // 📊 NUEVO: Estado para modo de Open Interest
  const [oiMode, setOiMode] = useState("histogram");

  // 🎯 NUEVO: Estado para Range Detection Settings
  const [showRangeDetectionSettings, setShowRangeDetectionSettings] = useState(false);
  const [selectedSymbolForRD, setSelectedSymbolForRD] = useState(null);
  const [indicatorManagers, setIndicatorManagers] = useState({});

  // 🔔 NUEVO: Estado para Rejection Pattern Settings
  const [showRejectionPatternSettings, setShowRejectionPatternSettings] = useState(false);
  const [selectedSymbolForRP, setSelectedSymbolForRP] = useState(null);
  const [rejectionPatternConfigs, setRejectionPatternConfigs] = useState({});

  // 📊 NUEVO: Estado para Support & Resistance Settings
  const [showSupportResistanceSettings, setShowSupportResistanceSettings] = useState(false);
  const [selectedSymbolForSR, setSelectedSymbolForSR] = useState(null);

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

  // 📊 NUEVO: Handler para abrir Support & Resistance Settings
  const handleOpenSupportResistanceSettings = (symbol, indicatorManagerRef) => {
    setSelectedSymbolForSR(symbol);

    // Guardar referencia del IndicatorManager
    if (indicatorManagerRef) {
      setIndicatorManagers(prev => ({
        ...prev,
        [symbol]: { ...prev[symbol], manager: indicatorManagerRef }
      }));
    }

    setShowSupportResistanceSettings(true);
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

  // 🧪 NUEVO: Handler para enviar alerta de prueba
  const handleTestAlert = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/test-alert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json();

      if (result.success) {
        const payload = result.payload;
        alert(`✅ Alerta de prueba enviada al bot!\n\n` +
              `Endpoint: ${result.endpoint}\n\n` +
              `Payload enviado:\n` +
              `{\n` +
              `  "pattern": "${payload.pattern}",\n` +
              `  "symbol": "${payload.symbol}",\n` +
              `  "price": ${payload.price},\n` +
              `  "confidence": ${payload.confidence}\n` +
              `}\n\n` +
              `Revisa los logs de tu bot en puerto 5000 o el dashboard en http://localhost:3000 para confirmar que la recibió.`);
      } else {
        alert(`❌ Error al enviar alerta de prueba:\n\n${result.message || result.error || 'Error desconocido'}\n\n` +
              `Endpoint: ${result.endpoint || 'http://localhost:5000/api/watchlist-alert'}\n\n` +
              `Asegúrate de que tu bot esté corriendo en el puerto 5000.`);
      }
    } catch (error) {
      alert(`❌ Error de conexión:\n\n${error.message}\n\n` +
            `Verifica que:\n` +
            `1. El backend esté corriendo en puerto 8000\n` +
            `2. Tu bot esté corriendo en puerto 5000`);
      console.error('Error sending test alert:', error);
    }
  };

  // 🚀 NUEVO: Handler para enviar múltiples alertas de prueba
  const handleTestAlertBatch = async () => {
    if (!confirm('¿Enviar 10 alertas de prueba al bot?\n\nEsto simulará un escenario real con múltiples señales simultáneas.')) {
      return;
    }

    try {
      const response = await fetch('http://localhost:8000/api/test-alert-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json();

      if (result.success) {
        const successful = result.total_sent;
        const total = result.total_attempted;
        const symbols = result.results.map(r => `${r.symbol}: $${r.price}`).join('\n');

        alert(`✅ ${successful}/${total} alertas enviadas exitosamente!\n\n` +
              `Endpoint: ${result.endpoint}\n\n` +
              `Monedas enviadas:\n${symbols}\n\n` +
              `Revisa los logs de tu bot en puerto 5000 o el dashboard en http://localhost:3000 para ver todas las alertas.`);
      } else {
        alert(`❌ Error al enviar alertas de prueba:\n\n${result.message || result.error || 'Error desconocido'}\n\n` +
              `Asegúrate de que tu bot esté corriendo en el puerto 5000.`);
      }
    } catch (error) {
      alert(`❌ Error de conexión:\n\n${error.message}\n\n` +
            `Verifica que:\n` +
            `1. El backend esté corriendo en puerto 8000\n` +
            `2. Tu bot esté corriendo en puerto 5000`);
      console.error('Error sending batch test alert:', error);
    }
  };

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

            {/* 🧪 Test Alert Buttons */}
            <button
              onClick={handleTestAlert}
              className="test-alert-btn"
              title="Enviar UNA alerta de prueba al bot de trading (puerto 5000)"
              style={{
                marginLeft: '15px',
                padding: '6px 12px',
                background: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '4px 0 0 4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 'bold',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => e.target.style.background = '#45a049'}
              onMouseLeave={(e) => e.target.style.background = '#4CAF50'}
            >
              🧪 Test 1x
            </button>
            <button
              onClick={handleTestAlertBatch}
              className="test-alert-batch-btn"
              title="Enviar MÚLTIPLES alertas de prueba (10 monedas) al bot de trading"
              style={{
                padding: '6px 12px',
                background: '#FF9800',
                color: 'white',
                border: 'none',
                borderLeft: '1px solid white',
                borderRadius: '0 4px 4px 0',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 'bold',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => e.target.style.background = '#F57C00'}
              onMouseLeave={(e) => e.target.style.background = '#FF9800'}
            >
              🚀 Test 10x
            </button>
          </div>
        </div>
      </div>

      {/* 🎯 NUEVO: Proximity Alert Dashboard */}
      <ProximityAlertDashboard symbols={symbols} indicatorManagers={indicatorManagers} />

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
            onOpenSupportResistanceSettings={(indicatorManagerRef) => handleOpenSupportResistanceSettings(sym, indicatorManagerRef)}
            rejectionPatternConfig={rejectionPatternConfigs[sym]}
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

      {/* 📊 NUEVO: Modal de Support & Resistance Settings */}
      {showSupportResistanceSettings && selectedSymbolForSR && (
        <SupportResistanceSettings
          symbol={selectedSymbolForSR}
          indicatorManager={indicatorManagers[selectedSymbolForSR]?.manager}
          onClose={() => {
            setShowSupportResistanceSettings(false);
            setSelectedSymbolForSR(null);
          }}
        />
      )}
    </div>
  );
};

export default Watchlist;