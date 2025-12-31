// src/components/Watchlist.jsx
import React, { useState, useEffect } from "react";
import MiniChart from "./MiniChart";
import VolumeProfileSettings from "./VolumeProfileSettings";
import RangeDetectionSettings from "./RangeDetectionSettings";
import RejectionPatternSettings from "./RejectionPatternSettings";
import DoubleTopBottomSettings from "./DoubleTopBottomSettings";
import SupportResistanceSettings from "./SupportResistanceSettings";
import VWAPSettings from "./VWAPSettings";
import FibonacciSettings from "./FibonacciSettings";
import ContinuationPatternSettings from "./ContinuationPatternSettings";
import wsManager from "./WebSocketManager";
import ProximityAlertDashboard from "./ProximityAlerts/ProximityAlertDashboard";
import IndicatorPreloader from "../utils/IndicatorPreloader";
import PresetManager from "../utils/PresetManager";
import IndicatorManagerRegistry from "../utils/IndicatorManagerRegistry";

const symbols = [
  "BTCUSDT", "ETHUSDT"
];

// CORREGIDO: Límites máximos de días por timeframe (deben coincidir con el backend)
const MAX_DAYS_BY_INTERVAL = {
  "1": 1,
  "5": 30,
  "15": 90,
  "30": 150,
  "60": 360,
  "240": 720,
  "D": 1440,
  "W": 730
};

// CORREGIDO: Opciones de días permitidas por timeframe
const DAYS_OPTIONS_BY_INTERVAL = {
  "1": [1],
  "5": [1, 2, 5, 7, 10, 15, 20, 30],
  "15": [1, 2, 5, 7, 10, 15, 30, 60, 90],
  "30": [1, 2, 5, 7, 10, 15, 30, 60, 90, 120, 150],
  "60": [1, 2, 5, 7, 10, 15, 30, 60, 90, 120, 180, 270, 360],
  "240": [1, 2, 5, 7, 10, 15, 30, 60, 90, 180, 270, 360, 540, 720],
  "D": [30, 60, 90, 180, 270, 365, 540, 720, 1080, 1440],
  "W": [90, 180, 365, 730]
};

const Watchlist = () => {
  const [interval, setInterval] = useState("60");  // Cambiado a 1 hora
  const [days, setDays] = useState("90");          // Cambiado a 90 días (histórico cargado)
  const [indicatorStates, setIndicatorStates] = useState({
    "Volume Delta": true,
    "CVD": true,
    "Volume Profile": false,
    "Open Interest": false,
    "VWAP": false,
    "Fibonacci": false,
    "Continuation Patterns": false,
    "Double Top/Bottom": true
  });

  // 🚀 Estados para precarga de indicadores
  const [isPreloading, setIsPreloading] = useState(true);
  const [preloadProgress, setPreloadProgress] = useState({ current: 0, total: 0 });

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

  // 📈 NUEVO: Estados para VWAP, Fibonacci y Continuation Pattern Settings
  const [showVWAPSettings, setShowVWAPSettings] = useState(false);
  const [selectedSymbolForVWAP, setSelectedSymbolForVWAP] = useState(null);
  const [showFibonacciSettings, setShowFibonacciSettings] = useState(false);
  const [selectedSymbolForFib, setSelectedSymbolForFib] = useState(null);
  const [showContinuationPatternSettings, setShowContinuationPatternSettings] = useState(false);
  const [selectedSymbolForCP, setSelectedSymbolForCP] = useState(null);

  // 🎯 NUEVO: Estado para Double Top/Bottom Settings
  const [showDoubleTopBottomSettings, setShowDoubleTopBottomSettings] = useState(false);
  const [selectedSymbolForDTB, setSelectedSymbolForDTB] = useState(null);
  const [isDTBReloading, setIsDTBReloading] = useState(false); // Estado de carga

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

  // 🚀 Precarga de indicadores al montar (NO BLOQUEANTE)
  useEffect(() => {
    // Precarga en background, NO bloquea renderizado de charts
    setIsPreloading(true);

    const preload = async () => {
      console.log('🚀 Iniciando precarga de indicadores en background...');
      const startTime = Date.now();

      // Limpiar cache expirado primero
      IndicatorPreloader.clearExpiredCache();

      // NO usar await aquí - dejar que corra en background
      IndicatorPreloader.preloadAllIndicators(
        symbols,
        interval,
        days,
        (current, total) => {
          setPreloadProgress({ current, total });

          // Ocultar banner cuando llegue al 100%
          if (current === total) {
            const duration = (Date.now() - startTime) / 1000;
            console.log(`✅ Precarga completada en ${duration}s`);
            setTimeout(() => setIsPreloading(false), 500); // Pequeño delay para mostrar 100%
          }
        }
      );

      // Ocultar banner después de 500ms para no bloquear UI
      // Los datos seguirán cargando en background
      setTimeout(() => {
        if (preloadProgress.current === 0) {
          setIsPreloading(false);
        }
      }, 500);
    };

    preload();
  }, [interval, days]); // Re-precargar si cambian timeframe o días

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

  // 📈 NUEVO: Handlers para VWAP, Fibonacci y Continuation Pattern Settings
  const handleOpenVWAPSettings = (symbol, indicatorManagerRef) => {
    setSelectedSymbolForVWAP(symbol);
    if (indicatorManagerRef) {
      setIndicatorManagers(prev => ({
        ...prev,
        [symbol]: { ...prev[symbol], manager: indicatorManagerRef }
      }));
    }
    setShowVWAPSettings(true);
  };

  const handleOpenFibonacciSettings = (symbol, indicatorManagerRef) => {
    setSelectedSymbolForFib(symbol);
    if (indicatorManagerRef) {
      setIndicatorManagers(prev => ({
        ...prev,
        [symbol]: { ...prev[symbol], manager: indicatorManagerRef }
      }));
    }
    setShowFibonacciSettings(true);
  };

  const handleOpenContinuationPatternSettings = (symbol, indicatorManagerRef) => {
    setSelectedSymbolForCP(symbol);
    if (indicatorManagerRef) {
      setIndicatorManagers(prev => ({
        ...prev,
        [symbol]: { ...prev[symbol], manager: indicatorManagerRef }
      }));
    }
    setShowContinuationPatternSettings(true);
  };

  // 🎯 NUEVO: Handler para abrir Double Top/Bottom Settings
  const handleOpenDoubleTopBottomSettings = (symbol, indicatorManagerRef) => {
    setSelectedSymbolForDTB(symbol);
    if (indicatorManagerRef) {
      setIndicatorManagers(prev => ({
        ...prev,
        [symbol]: { ...prev[symbol], manager: indicatorManagerRef }
      }));
    }
    setShowDoubleTopBottomSettings(true);
  };

  // 🎯 Handler para cerrar Double Top/Bottom Settings
  const handleCloseDoubleTopBottomSettings = () => {
    setShowDoubleTopBottomSettings(false);
    setSelectedSymbolForDTB(null);
  };

  // 📈 NUEVO: Handlers para cambio de config
  const handleVWAPConfigChange = (config, saveAsOverride = true) => {
    if (saveAsOverride) {
      // Modo símbolo: solo actualizar el símbolo actual
      const manager = indicatorManagers[selectedSymbolForVWAP]?.manager;
      if (manager) {
        const vwapIndicator = manager.getVWAPIndicator();
        if (vwapIndicator) {
          vwapIndicator.updateConfig(config);
          console.log(`[Watchlist] Updated VWAP config for ${selectedSymbolForVWAP}`);
          PresetManager.updateSymbolOverride(selectedSymbolForVWAP, "VWAP", config);
          console.log(`[Watchlist] 🔧 VWAP override guardado para ${selectedSymbolForVWAP}`);
        }
      }
    } else {
      // Modo global: actualizar TODOS los símbolos que NO tengan override
      console.log(`[Watchlist] 🌐 Aplicando preset global de VWAP a todos los símbolos sin override`);

      const registeredSymbols = IndicatorManagerRegistry.getAllSymbols();
      console.log(`[Watchlist] 📋 Símbolos registrados: ${registeredSymbols.length}/${symbols.length}`);

      symbols.forEach(symbol => {
        const hasOverride = PresetManager.hasOverride(symbol, "VWAP");
        if (!hasOverride) {
          const manager = IndicatorManagerRegistry.get(symbol);
          if (manager) {
            const vwapIndicator = manager.getVWAPIndicator();
            if (vwapIndicator) {
              vwapIndicator.updateConfig(config);
              console.log(`[Watchlist] ✅ ${symbol}: VWAP actualizado con preset global`);
            }
          } else {
            console.log(`[Watchlist] ⚠️ ${symbol}: Manager no encontrado en registro`);
          }
        } else {
          console.log(`[Watchlist] ⏭️ ${symbol}: Tiene override, no se actualiza`);
        }
      });
    }
  };

  const handleFibonacciConfigChange = (config, saveAsOverride = true) => {
    if (saveAsOverride) {
      // Modo símbolo: solo actualizar el símbolo actual
      const manager = indicatorManagers[selectedSymbolForFib]?.manager;
      if (manager) {
        const fibIndicator = manager.getFibonacciIndicator();
        if (fibIndicator) {
          fibIndicator.updateConfig(config);
          console.log(`[Watchlist] Updated Fibonacci config for ${selectedSymbolForFib}`);
          PresetManager.updateSymbolOverride(selectedSymbolForFib, "Fibonacci", config);
          console.log(`[Watchlist] 🔧 Fibonacci override guardado para ${selectedSymbolForFib}`);
        }
      }
    } else {
      // Modo global: actualizar TODOS los símbolos que NO tengan override
      console.log(`[Watchlist] 🌐 Aplicando preset global de Fibonacci a todos los símbolos sin override`);

      symbols.forEach(symbol => {
        const hasOverride = PresetManager.hasOverride(symbol, "Fibonacci");
        if (!hasOverride) {
          const manager = IndicatorManagerRegistry.get(symbol);
          if (manager) {
            const fibIndicator = manager.getFibonacciIndicator();
            if (fibIndicator) {
              fibIndicator.updateConfig(config);
              console.log(`[Watchlist] ✅ ${symbol}: Fibonacci actualizado con preset global`);
            }
          }
        } else {
          console.log(`[Watchlist] ⏭️ ${symbol}: Tiene override, no se actualiza`);
        }
      });
    }
  };

  const handleContinuationPatternConfigChange = (config, saveAsOverride = true) => {
    if (saveAsOverride) {
      // Modo símbolo: solo actualizar el símbolo actual
      const manager = indicatorManagers[selectedSymbolForCP]?.manager;
      if (manager) {
        const cpIndicator = manager.getContinuationPatternIndicator();
        if (cpIndicator) {
          cpIndicator.updateConfig(config);
          PresetManager.updateSymbolOverride(selectedSymbolForCP, "Continuation Patterns", config);
          console.log(`[Watchlist] 🔧 Continuation Patterns override guardado para ${selectedSymbolForCP}`);
        }
      }
    } else {
      // Modo global: actualizar TODOS los símbolos que NO tengan override
      console.log(`[Watchlist] 🌐 Aplicando preset global de Continuation Patterns a todos los símbolos sin override`);

      const registeredSymbols = IndicatorManagerRegistry.getAllSymbols();
      console.log(`[Watchlist] 📋 Símbolos registrados: ${registeredSymbols.length}/${symbols.length}`, registeredSymbols);

      symbols.forEach(symbol => {
        const hasOverride = PresetManager.hasOverride(symbol, "Continuation Patterns");
        if (!hasOverride) {
          const manager = IndicatorManagerRegistry.get(symbol);
          if (manager) {
            const cpIndicator = manager.getContinuationPatternIndicator();
            if (cpIndicator) {
              cpIndicator.updateConfig(config);
              console.log(`[Watchlist] ✅ ${symbol}: Continuation Patterns actualizado con preset global`);
            } else {
              console.log(`[Watchlist] ⚠️ ${symbol}: getContinuationPatternIndicator() devolvió null`);
            }
          } else {
            console.log(`[Watchlist] ⚠️ ${symbol}: Manager no encontrado en Registry`);
          }
        } else {
          console.log(`[Watchlist] ⏭️ ${symbol}: Tiene override, no se actualiza`);
        }
      });
    }
  };

  // 🎯 NUEVO: Handler para cambio de config de Double Top/Bottom
  // Se llama SOLO cuando el usuario presiona "Save & Close"
  const handleDoubleTopBottomConfigChange = async (config) => {
    const manager = indicatorManagers[selectedSymbolForDTB]?.manager;
    if (manager) {
      const dtbIndicator = manager.indicators.find(ind => ind.name === "Double Top/Bottom");
      if (dtbIndicator) {
        // Actualizar config inmediatamente (localStorage)
        dtbIndicator.updateConfig(config);
        console.log(`[Watchlist] Updated Double Top/Bottom config for ${selectedSymbolForDTB}`);

        // Recargar patrones con la nueva configuración INMEDIATAMENTE (solo una vez)
        if (dtbIndicator.enabled) {
          setIsDTBReloading(true); // Mostrar indicador de carga
          const startTime = Date.now();
          console.log(`[Watchlist] 🔄 Reloading Double Top/Bottom patterns for ${selectedSymbolForDTB}...`);

          try {
            await dtbIndicator.fetchData();
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`[Watchlist] ✅ Patterns reloaded for ${selectedSymbolForDTB} in ${duration}s`);

            // Forzar redibujado del chart
            if (manager.requestRedraw) {
              manager.requestRedraw();
            }
          } catch (error) {
            console.error(`[Watchlist] ❌ Error reloading patterns:`, error);
          } finally {
            setIsDTBReloading(false); // Ocultar indicador de carga
          }
        }
      }
    }
  };

  // 🔔 NUEVO: Handler para cambio de config de patrones
  const handleRejectionPatternConfigChange = (config, saveAsOverride = true) => {
    setRejectionPatternConfigs(prev => ({
      ...prev,
      [selectedSymbolForRP]: config
    }));

    // Actualizar el IndicatorManager con la nueva configuración
    const manager = indicatorManagers[selectedSymbolForRP]?.manager;
    if (manager) {
      manager.updateRejectionPatternConfig(config);
      console.log(`[Watchlist] Updated rejection pattern config for ${selectedSymbolForRP}`);

      // ✅ Guardar como override del símbolo
      if (saveAsOverride) {
        PresetManager.updateSymbolOverride(selectedSymbolForRP, "Rejection Patterns", config);
        console.log(`[Watchlist] 🔧 Rejection Patterns override guardado para ${selectedSymbolForRP}`);
      }
    }
  };

  // 📊 NUEVO: Handler para cambio de config de Support & Resistance
  const handleSupportResistanceConfigChange = (config, saveAsOverride = true) => {
    const manager = indicatorManagers[selectedSymbolForSR]?.manager;
    if (manager) {
      const srIndicator = manager.getSupportResistanceIndicator();
      if (srIndicator) {
        srIndicator.updateConfig(config);
        console.log(`[Watchlist] Updated Support & Resistance config for ${selectedSymbolForSR}`);

        // ✅ Guardar como override del símbolo
        if (saveAsOverride) {
          PresetManager.updateSymbolOverride(selectedSymbolForSR, "Support & Resistance", config);
          console.log(`[Watchlist] 🔧 Support & Resistance override guardado para ${selectedSymbolForSR}`);
        }
      }
    }
  };

  // 🎯 NUEVO: Handler para cambio de config de Range Detection
  const handleRangeDetectionConfigChange = (config, saveAsOverride = true) => {
    const manager = indicatorManagers[selectedSymbolForRD]?.manager;
    if (manager) {
      const rdIndicator = manager.getRangeDetector();
      if (rdIndicator) {
        rdIndicator.updateConfig(config);
        console.log(`[Watchlist] Updated Range Detection config for ${selectedSymbolForRD}`);

        // ✅ Guardar como override del símbolo
        if (saveAsOverride) {
          PresetManager.updateSymbolOverride(selectedSymbolForRD, "Range Detection", config);
          console.log(`[Watchlist] 🔧 Range Detection override guardado para ${selectedSymbolForRD}`);
        }
      }
    }
  };

  // 🧪 NUEVO: Handler para enviar alerta de prueba
  const handleTestAlert = async () => {
    console.log('\n' + '='.repeat(80));
    console.log('[TEST ALERT] 🧪 Initiating test alert from frontend...');
    console.log('='.repeat(80));
    console.log('[TEST ALERT] Target: http://localhost:8000/api/test-alert');

    try {
      console.log('[TEST ALERT] Sending POST request...');
      const response = await fetch('http://localhost:8000/api/test-alert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log(`[TEST ALERT] Response status: ${response.status}`);
      const result = await response.json();
      console.log('[TEST ALERT] Response body:', result);

      if (result.success) {
        const payload = result.payload;
        console.log('[TEST ALERT] ✅ Test alert sent successfully!');
        console.log('[TEST ALERT] Payload sent to bot:', payload);

        alert(`✅ Alerta de prueba enviada al bot!\n\n` +
              `Endpoint: ${result.endpoint}\n\n` +
              `Payload enviado:\n` +
              `{\n` +
              `  "pattern": "${payload.pattern}",\n` +
              `  "symbol": "${payload.symbol}",\n` +
              `  "price": ${payload.price},\n` +
              `  "confidence": ${payload.confidence}\n` +
              `}\n\n` +
              `${result.note || ''}\n\n` +
              `Revisa los logs de tu bot en puerto 5000 o el dashboard en http://localhost:3000 para confirmar que la recibió.`);
      } else {
        console.error('[TEST ALERT] ❌ Failed:', result.message || result.error);

        alert(`❌ Error al enviar alerta de prueba:\n\n${result.message || result.error || 'Error desconocido'}\n\n` +
              `Endpoint: ${result.endpoint || 'http://localhost:5000/api/watchlist-alert'}\n\n` +
              `Asegúrate de que tu bot esté corriendo en el puerto 5000.`);
      }
    } catch (error) {
      console.error('[TEST ALERT] ❌ Exception:', error);

      alert(`❌ Error de conexión:\n\n${error.message}\n\n` +
            `Verifica que:\n` +
            `1. El backend esté corriendo en puerto 8000\n` +
            `2. Tu bot esté corriendo en puerto 5000`);
      console.error('Error sending test alert:', error);
    }

    console.log('='.repeat(80) + '\n');
  };

  // 🚀 NUEVO: Handler para enviar múltiples alertas de prueba
  const handleTestAlertBatch = async () => {
    if (!confirm('¿Enviar 10 alertas de prueba al bot?\n\nEsto tomará ~20 segundos (2s delay entre cada alerta).')) {
      console.log('[BATCH TEST] User cancelled batch test');
      return;
    }

    console.log('\n' + '='.repeat(80));
    console.log('[BATCH TEST] 🚀 Starting batch test (10 alerts)...');
    console.log('='.repeat(80));
    console.log('[BATCH TEST] Target: http://localhost:8000/api/test-alert-batch');
    console.log('[BATCH TEST] Expected duration: ~20 seconds');

    try {
      console.log('[BATCH TEST] Sending POST request...');
      const startTime = Date.now();

      const response = await fetch('http://localhost:8000/api/test-alert-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[BATCH TEST] Response received after ${elapsed}s`);
      console.log(`[BATCH TEST] Response status: ${response.status}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('[BATCH TEST] Response body:', result);

      if (result.success || result.total_sent > 0) {
        const successful = result.total_sent;
        const total = result.total_attempted;
        const symbols = result.results
          .filter(r => r.success)
          .map(r => `✅ ${r.symbol}: $${r.price}`)
          .join('\n');

        const failed = result.results
          .filter(r => !r.success)
          .map(r => `❌ ${r.symbol}: ${r.error || 'Failed'}`)
          .join('\n');

        let message = `✅ ${successful}/${total} alertas enviadas exitosamente!\n\n`;
        message += `Endpoint: ${result.endpoint}\n\n`;

        if (symbols) {
          message += `Alertas exitosas:\n${symbols}\n\n`;
        }

        if (failed) {
          message += `Alertas fallidas:\n${failed}\n\n`;
        }

        if (result.errors && result.errors.length > 0) {
          message += `Errores:\n${result.errors.join('\n')}\n\n`;
        }

        message += `Revisa los logs de tu bot en puerto 5000 o el dashboard en http://localhost:3000.`;

        console.log(`[BATCH TEST] ✅ Batch complete: ${successful}/${total} successful`);
        console.log(`[BATCH TEST] Successful alerts:`, result.results.filter(r => r.success));
        if (failed) {
          console.log(`[BATCH TEST] ❌ Failed alerts:`, result.results.filter(r => !r.success));
        }
        console.log('='.repeat(80) + '\n');

        alert(message);
      } else {
        console.error(`[BATCH TEST] ❌ Batch failed: ${result.message || result.error}`);
        console.error('[BATCH TEST] Results:', result);
        console.log('='.repeat(80) + '\n');

        alert(`❌ Error al enviar alertas de prueba:\n\n${result.message || result.error || 'Error desconocido'}\n\n` +
              `Total enviado: ${result.total_sent || 0}/${result.total_attempted || 0}\n\n` +
              `Asegúrate de que tu bot esté corriendo en el puerto 5000.`);
      }
    } catch (error) {
      console.error('[BATCH TEST] ❌ Exception:', error);
      console.log('='.repeat(80) + '\n');

      alert(`❌ Error de conexión:\n\n${error.message}\n\n` +
            `Verifica que:\n` +
            `1. El backend esté corriendo en puerto 8000\n` +
            `2. Tu bot esté corriendo en puerto 5000\n` +
            `3. El backend haya terminado de procesar (toma ~20s)`);
      console.error('Error sending batch test alert:', error);
    }
  };

  // Obtener opciones de días disponibles según el timeframe actual
  const getAvailableDaysOptions = () => {
    return DAYS_OPTIONS_BY_INTERVAL[interval] || [1, 2, 5, 10, 30];
  };

  return (
    <div className="watchlist-container">
      {/* Banner de precarga */}
      {isPreloading && (
        <div style={{
          position: 'fixed',
          top: '10px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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
          ⏳ Precargando indicadores... {preloadProgress.current}/{preloadProgress.total} ({preloadProgress.total > 0 ? Math.round(preloadProgress.current / preloadProgress.total * 100) : 0}%)
        </div>
      )}

      {/* Banner de recarga de Double Top/Bottom */}
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
          🔄 Recargando patrones Double Top/Bottom para {selectedSymbolForDTB}...
        </div>
      )}

      <div className="watchlist-header">
        <h2>Watchlist PoC - Phase 3: Volume Profile + UI Controls</h2>

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

            <label>
              <input
                type="checkbox"
                checked={indicatorStates["VWAP"]}
                onChange={() => toggleIndicator("VWAP")}
              />
              VWAP
            </label>

            <label>
              <input
                type="checkbox"
                checked={indicatorStates["Fibonacci"]}
                onChange={() => toggleIndicator("Fibonacci")}
              />
              Fibonacci
            </label>

            <label>
              <input
                type="checkbox"
                checked={indicatorStates["Continuation Patterns"]}
                onChange={() => toggleIndicator("Continuation Patterns")}
              />
              Continuation Patterns
            </label>

            <label>
              <input
                type="checkbox"
                checked={indicatorStates["Double Top/Bottom"]}
                onChange={() => toggleIndicator("Double Top/Bottom")}
              />
              Double Top/Bottom
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
            onOpenVWAPSettings={(indicatorManagerRef) => handleOpenVWAPSettings(sym, indicatorManagerRef)}
            onOpenFibonacciSettings={(indicatorManagerRef) => handleOpenFibonacciSettings(sym, indicatorManagerRef)}
            onOpenContinuationPatternSettings={(indicatorManagerRef) => handleOpenContinuationPatternSettings(sym, indicatorManagerRef)}
            onOpenDoubleTopBottomSettings={(indicatorManagerRef) => handleOpenDoubleTopBottomSettings(sym, indicatorManagerRef)}
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
              onConfigChange={handleRangeDetectionConfigChange}
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
          onConfigChange={handleSupportResistanceConfigChange}
          onClose={() => {
            setShowSupportResistanceSettings(false);
            setSelectedSymbolForSR(null);
          }}
        />
      )}

      {/* 📈 NUEVO: Modal de VWAP Settings */}
      {showVWAPSettings && selectedSymbolForVWAP && (
        <div className="modal-overlay" onClick={() => setShowVWAPSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Configuración VWAP</h3>
              <button
                className="modal-close-btn"
                onClick={() => setShowVWAPSettings(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <VWAPSettings
                config={(() => {
                  const manager = indicatorManagers[selectedSymbolForVWAP]?.manager;
                  const vwapIndicator = manager?.getVWAPIndicator();
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
                currentSymbol={selectedSymbolForVWAP}
                interval={interval}
              />
            </div>
          </div>
        </div>
      )}

      {/* 📈 NUEVO: Modal de Fibonacci Settings */}
      {showFibonacciSettings && selectedSymbolForFib && (
        <div className="modal-overlay" onClick={() => setShowFibonacciSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Configuración Fibonacci</h3>
              <button
                className="modal-close-btn"
                onClick={() => setShowFibonacciSettings(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <FibonacciSettings
                config={(() => {
                  const manager = indicatorManagers[selectedSymbolForFib]?.manager;
                  const fibIndicator = manager?.getFibonacciIndicator();
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
                currentSymbol={selectedSymbolForFib}
              />
            </div>
          </div>
        </div>
      )}

      {/* 📈 NUEVO: Modal de Continuation Pattern Settings */}
      {showContinuationPatternSettings && selectedSymbolForCP && (
        <div className="modal-overlay" onClick={() => setShowContinuationPatternSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Configuración Continuation Patterns</h3>
              <button
                className="modal-close-btn"
                onClick={() => setShowContinuationPatternSettings(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <ContinuationPatternSettings
                config={(() => {
                  const manager = indicatorManagers[selectedSymbolForCP]?.manager;
                  const cpIndicator = manager?.getContinuationPatternIndicator();
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
                  } : {
                    showContinuation: true,
                    showTrendStart: true,
                    showMomentum: true,
                    showReversal: false,
                    minConfidence: 60,
                    includeVWAP: true,
                    includeFibonacci: false,
                    vwapConfig: {
                      vwap_type: 'session',
                      reset_hour: 0,
                      apply_crypto_adjustment: true
                    },
                    fibonacciConfig: {
                      auto_detect: true,
                      lookback: 50,
                      include_extensions: false
                    },
                    showLabels: true,
                    showConfidence: true,
                    iconSize: 9,  // Changed from 16 to 9px
                    patternParams: {
                      reversal: {
                        minWickRatio: 1.5,
                        maxOppositeWick: 0.25,
                        minBodyPosition: 0.5,
                        engulfingTolerance: 0.02,
                        invertProximity: false
                      },
                      continuation: {
                        maxConsolidationRange: 0.03,
                        minBreakoutSize: 0.01
                      },
                      momentum: {
                        minBodyPercent: 0.3,
                        minConsecutive: 3
                      }
                    }
                  };
                })()}
                onConfigChange={handleContinuationPatternConfigChange}
                currentSymbol={selectedSymbolForCP}
              />
            </div>
          </div>
        </div>
      )}

      {/* 🎯 NUEVO: Modal de Double Top/Bottom Settings */}
      {showDoubleTopBottomSettings && selectedSymbolForDTB && (
        <div className="modal-overlay" onClick={handleCloseDoubleTopBottomSettings}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Double Top/Bottom Settings - {selectedSymbolForDTB}</h3>
              <button
                className="modal-close-btn"
                onClick={handleCloseDoubleTopBottomSettings}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <DoubleTopBottomSettings
                symbol={selectedSymbolForDTB}
                onConfigChange={handleDoubleTopBottomConfigChange}
                onClose={handleCloseDoubleTopBottomSettings}
                indicator={(() => {
                  const manager = indicatorManagers[selectedSymbolForDTB]?.manager;
                  return manager?.indicators.find(ind => ind.name === "Double Top/Bottom");
                })()}
                initialConfig={(() => {
                  const manager = indicatorManagers[selectedSymbolForDTB]?.manager;
                  const dtbIndicator = manager?.indicators.find(ind => ind.name === "Double Top/Bottom");
                  return dtbIndicator?.config;
                })()}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Watchlist;