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
    profiles: [
      {
        id: 'default_scalping',
        name: '⚡ Scalping Agresivo',
        description: 'Alerts on strong levels with high confidence patterns',
        indicators: {
          'Support & Resistance': {
            enabled: true,
            minStrength: 8,
            proximityPercent: 0.2,
            minTouches: 2
          },
          'Rejection Patterns': {
            enabled: true,
            minConfidence: 75,
            requireNearLevel: true
          },
          'Volume Profile': {
            enabled: false,
            alertOnPOC: true,
            alertOnValueArea: false,
            proximityPercent: 0.3
          },
          'Open Interest': {
            enabled: false,
            minChangePercent: 20,
            lookbackCandles: 3
          },
          'Volume': {
            enabled: false,
            minMultiplier: 2.0,
            lookbackPeriod: 20
          },
          'Volume Delta': {
            enabled: false,
            minMultiplier: 2.0,
            lookbackPeriod: 20
          },
          'CVD': {
            enabled: false,
            alertOnExtremes: true,
            alertOnTrendChange: true,
            extremeThreshold: 0.05
          }
        },
        confluenceEnabled: true,
        minIndicatorsForConfluence: 2,
        confluenceWindowCandles: 2,
        confluencePriceProximity: 0.3
      }
    ],
    activeProfileId: 'default_scalping'
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

  // 🎯 NUEVO: Detectar confluencias entre múltiples indicadores
  const checkConfluence = (allAlerts, newAlert, profile) => {
    // Solo verificar si el nuevo alert tiene precio y símbolo
    if (!newAlert.data || !newAlert.data.price || !newAlert.symbol) return;

    const now = Date.now();
    const timeWindowMs = getIntervalMs(interval) * profile.confluenceWindowCandles;
    const priceProximityPercent = profile.confluencePriceProximity;
    const targetPrice = newAlert.data.price;

    // Buscar alertas recientes del mismo símbolo
    const recentAlerts = allAlerts.filter(a => {
      // Excluir el nuevo alert de la búsqueda
      if (a.id === newAlert.id) return false;

      // Mismo símbolo
      if (a.symbol !== newAlert.symbol) return false;

      // Dentro de la ventana de tiempo
      const timeDiff = Math.abs(now - a.timestamp);
      if (timeDiff > timeWindowMs) return false;

      // Tiene precio
      if (!a.data || !a.data.price) return false;

      // Precio cercano (dentro de la proximidad)
      const priceDiff = Math.abs((a.data.price - targetPrice) / targetPrice * 100);
      if (priceDiff > priceProximityPercent) return false;

      // No es una alerta de confluencia (para evitar recursión)
      if (a.type === 'Confluence') return false;

      return true;
    });

    // Contar indicadores únicos involucrados (incluyendo el nuevo)
    const indicatorTypes = new Set([newAlert.indicatorType]);
    recentAlerts.forEach(a => {
      if (a.indicatorType) indicatorTypes.add(a.indicatorType);
    });

    const indicatorCount = indicatorTypes.size;

    // Si cumplimos el mínimo de indicadores, crear alerta de confluencia
    if (indicatorCount >= profile.minIndicatorsForConfluence) {
      // Verificar cooldown para confluencias
      const confluenceKey = `confluence_${newAlert.symbol}_${Math.floor(targetPrice)}`;
      const lastConfluence = localStorage.getItem(confluenceKey);

      if (lastConfluence && (now - parseInt(lastConfluence)) < 1800000) { // 30 minutos cooldown
        return;
      }

      // Crear descripción de la confluencia
      const indicatorsList = Array.from(indicatorTypes).join(', ');
      const avgPrice = ([newAlert, ...recentAlerts].reduce((sum, a) => sum + a.data.price, 0)) / (recentAlerts.length + 1);

      const confluenceAlert = {
        indicatorType: 'Confluence',
        severity: 'HIGH', // Las confluencias siempre son HIGH
        icon: '🎯',
        title: `${newAlert.symbol} CONFLUENCE DETECTED`,
        symbol: newAlert.symbol,
        interval: interval,
        type: 'Confluence',
        description: `${indicatorCount} indicators agree near $${avgPrice.toFixed(2)}\n` +
                     `Indicators: ${indicatorsList}\n` +
                     `Price range: ${priceProximityPercent}%\n` +
                     `Time window: ${profile.confluenceWindowCandles} candles`,
        data: {
          price: avgPrice,
          indicatorCount: indicatorCount,
          indicators: Array.from(indicatorTypes),
          involvedAlerts: [newAlert.id, ...recentAlerts.map(a => a.id)],
          priceRange: priceProximityPercent,
          timeWindow: profile.confluenceWindowCandles
        },
        id: Date.now() + Math.random(),
        timestamp: now,
        profileName: profile.name
      };

      // Agregar la alerta de confluencia
      setAlerts(prev => [confluenceAlert, ...prev].slice(0, 100));
      setToastAlerts(prev => [...prev, confluenceAlert]);

      // Reproducir sonido para confluencia (siempre HIGH)
      if (alertConfig.soundEnabled) {
        playAlertSound('HIGH');
      }

      // Guardar cooldown
      localStorage.setItem(confluenceKey, now.toString());

      console.log('[Watchlist] 🎯 CONFLUENCE DETECTED:', confluenceAlert);
    }
  };

  // Helper function to get interval in milliseconds
  const getIntervalMs = (interval) => {
    const map = {
      '5': 5 * 60 * 1000,
      '15': 15 * 60 * 1000,
      '30': 30 * 60 * 1000,
      '60': 60 * 60 * 1000,
      '240': 240 * 60 * 1000,
      'D': 24 * 60 * 60 * 1000,
      'W': 7 * 24 * 60 * 60 * 1000
    };
    return map[interval] || 15 * 60 * 1000;
  };

  // 🔊 NUEVO: Reproducir sonido basado en severidad
  const playAlertSound = (severity) => {
    try {
      // Crear contexto de audio
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      // Conectar nodos
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Configurar según severidad
      let frequency, duration;
      switch (severity) {
        case 'HIGH':
          // Sonido urgente: frecuencia alta, más largo
          frequency = 880; // A5
          duration = 0.3;
          // Beep doble
          oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
          gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + duration);

          // Segundo beep
          setTimeout(() => {
            const osc2 = audioContext.createOscillator();
            const gain2 = audioContext.createGain();
            osc2.connect(gain2);
            gain2.connect(audioContext.destination);
            osc2.frequency.setValueAtTime(frequency, audioContext.currentTime);
            gain2.gain.setValueAtTime(0.3, audioContext.currentTime);
            gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
            osc2.start(audioContext.currentTime);
            osc2.stop(audioContext.currentTime + duration);
          }, 200);
          break;

        case 'MEDIUM':
          // Sonido moderado: frecuencia media
          frequency = 660; // E5
          duration = 0.2;
          oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
          gainNode.gain.setValueAtTime(0.25, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + duration);
          break;

        case 'LOW':
        default:
          // Sonido suave: frecuencia baja
          frequency = 440; // A4
          duration = 0.15;
          oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
          gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + duration);
          break;
      }

      // Limpiar después del sonido
      setTimeout(() => {
        audioContext.close();
      }, 1000);

    } catch (error) {
      console.error('[Watchlist] Error playing alert sound:', error);
    }
  };

  // 🔔 NUEVO: Agregar nueva alerta (con validación basada en perfiles)
  const addAlert = (alert) => {
    // Verificar si las alertas están habilitadas
    if (!alertConfig.enabled) return;

    // Obtener el perfil activo
    const activeProfile = alertConfig.profiles.find(p => p.id === alertConfig.activeProfileId);
    if (!activeProfile) {
      console.log('[Watchlist] No active profile, alert rejected');
      return;
    }

    // Verificar si el indicador está habilitado en el perfil
    const indicatorSettings = activeProfile.indicators[alert.indicatorType];
    if (!indicatorSettings || !indicatorSettings.enabled) {
      console.log(`[Watchlist] Indicator ${alert.indicatorType} not enabled in profile, alert rejected`);
      return;
    }

    // Validar contra filtros específicos del perfil según el tipo de indicador
    let passesFilters = true;
    let calculatedSeverity = alert.severity || 'LOW';

    if (alert.indicatorType === 'Support & Resistance' && alert.data) {
      // Validar contra filtros de S/R
      if (alert.data.strength < indicatorSettings.minStrength) {
        console.log(`[Watchlist] S/R strength ${alert.data.strength} below minimum ${indicatorSettings.minStrength}`);
        passesFilters = false;
      }
      if (alert.data.touches < indicatorSettings.minTouches) {
        console.log(`[Watchlist] S/R touches ${alert.data.touches} below minimum ${indicatorSettings.minTouches}`);
        passesFilters = false;
      }
      if (alert.data.distance > indicatorSettings.proximityPercent) {
        console.log(`[Watchlist] S/R distance ${alert.data.distance}% above maximum ${indicatorSettings.proximityPercent}%`);
        passesFilters = false;
      }

      // Calcular severidad basada en strength
      if (alert.data.strength >= 9) calculatedSeverity = 'HIGH';
      else if (alert.data.strength >= 7) calculatedSeverity = 'MEDIUM';
      else calculatedSeverity = 'LOW';
    }

    if (alert.indicatorType === 'Rejection Patterns' && alert.data) {
      // Validar contra filtros de Rejection Patterns
      if (alert.data.confidence < indicatorSettings.minConfidence) {
        console.log(`[Watchlist] Pattern confidence ${alert.data.confidence}% below minimum ${indicatorSettings.minConfidence}%`);
        passesFilters = false;
      }

      // Calcular severidad basada en confidence
      if (alert.data.confidence >= 85) calculatedSeverity = 'HIGH';
      else if (alert.data.confidence >= 70) calculatedSeverity = 'MEDIUM';
      else calculatedSeverity = 'LOW';
    }

    if (alert.indicatorType === 'Volume Profile' && alert.data) {
      // Validar contra filtros de Volume Profile
      if (alert.data.levelType === 'POC' && !indicatorSettings.alertOnPOC) {
        passesFilters = false;
      }
      if (alert.data.levelType === 'ValueArea' && !indicatorSettings.alertOnValueArea) {
        passesFilters = false;
      }
      if (alert.data.distance > indicatorSettings.proximityPercent) {
        passesFilters = false;
      }
    }

    if (alert.indicatorType === 'Open Interest' && alert.data) {
      // Validar contra filtros de Open Interest
      if (Math.abs(alert.data.changePercent) < indicatorSettings.minChangePercent) {
        console.log(`[Watchlist] OI change ${alert.data.changePercent}% below minimum ${indicatorSettings.minChangePercent}%`);
        passesFilters = false;
      }

      // Calcular severidad basada en changePercent
      const absChange = Math.abs(alert.data.changePercent);
      if (absChange >= 30) calculatedSeverity = 'HIGH';
      else if (absChange >= 20) calculatedSeverity = 'MEDIUM';
      else calculatedSeverity = 'LOW';
    }

    if (alert.indicatorType === 'Volume' && alert.data) {
      // Validar contra filtros de Volume
      if (alert.data.multiplier < indicatorSettings.minMultiplier) {
        console.log(`[Watchlist] Volume multiplier ${alert.data.multiplier} below minimum ${indicatorSettings.minMultiplier}`);
        passesFilters = false;
      }

      // Calcular severidad basada en multiplier
      if (alert.data.multiplier >= 4.0) calculatedSeverity = 'HIGH';
      else if (alert.data.multiplier >= 2.5) calculatedSeverity = 'MEDIUM';
      else calculatedSeverity = 'LOW';
    }

    if (alert.indicatorType === 'Volume Delta' && alert.data) {
      // Validar contra filtros de Volume Delta
      if (alert.data.multiplier < indicatorSettings.minMultiplier) {
        console.log(`[Watchlist] Volume Delta multiplier ${alert.data.multiplier} below minimum ${indicatorSettings.minMultiplier}`);
        passesFilters = false;
      }

      // Calcular severidad basada en multiplier
      if (alert.data.multiplier >= 4.0) calculatedSeverity = 'HIGH';
      else if (alert.data.multiplier >= 2.5) calculatedSeverity = 'MEDIUM';
      else calculatedSeverity = 'LOW';
    }

    if (alert.indicatorType === 'CVD' && alert.data) {
      // Validar contra filtros de CVD
      // Las alertas de CVD ya están filtradas por el indicador
      // Solo verificamos si están habilitadas las opciones correctas
      if (alert.data.alertType === 'maximum' || alert.data.alertType === 'minimum') {
        if (!indicatorSettings.alertOnExtremes) {
          passesFilters = false;
        }
      }
      if (alert.data.alertType === 'strong_bullish_trend' || alert.data.alertType === 'strong_bearish_trend') {
        if (!indicatorSettings.alertOnTrendChange) {
          passesFilters = false;
        }
      }

      // La severidad ya viene calculada por el indicador
    }

    if (!passesFilters) {
      console.log('[Watchlist] Alert rejected by profile filters');
      return;
    }

    // Crear alerta con ID único y severidad calculada
    const newAlert = {
      ...alert,
      severity: calculatedSeverity,
      id: Date.now() + Math.random(),
      timestamp: alert.timestamp || Date.now(),
      profileName: activeProfile.name
    };

    // Agregar a alertas
    setAlerts(prev => {
      const updatedAlerts = [newAlert, ...prev].slice(0, 100); // Mantener solo últimas 100

      // 🎯 NUEVO: Detección de Confluencias
      if (activeProfile.confluenceEnabled && newAlert.data && newAlert.data.price) {
        checkConfluence(updatedAlerts, newAlert, activeProfile);
      }

      return updatedAlerts;
    });

    // Mostrar toast notification
    setToastAlerts(prev => [...prev, newAlert]);

    // Reproducir sonido si está habilitado
    if (alertConfig.soundEnabled) {
      playAlertSound(calculatedSeverity);
    }

    // Mostrar notificación del navegador si está habilitada
    if (alertConfig.browserNotifications && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(newAlert.title, {
        body: newAlert.description,
        icon: newAlert.icon
      });
    }

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
              🔔 Alertas
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
                const testTypes = ['Soporte', 'Resistencia'];

                const randomSymbol = testSymbols[Math.floor(Math.random() * testSymbols.length)];
                const randomType = testTypes[Math.floor(Math.random() * testTypes.length)];
                const randomPrice = (Math.random() * 50000 + 20000).toFixed(2);
                const randomLevel = (parseFloat(randomPrice) * (1 + (Math.random() - 0.5) * 0.01)).toFixed(2);

                // Generar valores que siempre pasen los filtros del perfil por defecto
                const strength = 8 + Math.random() * 2; // 8-10 (mínimo del perfil default es 8)
                const touches = 2 + Math.floor(Math.random() * 3); // 2-4 (mínimo es 2)
                const distance = Math.random() * 0.15; // 0-0.15% (máximo del perfil es 0.2%)

                addAlert({
                  indicatorType: 'Support & Resistance',
                  severity: 'HIGH', // Será recalculado por addAlert
                  icon: randomType === 'Soporte' ? '🟢' : '🔴',
                  title: `${randomSymbol} cerca de ${randomType}`,
                  symbol: randomSymbol,
                  interval: interval,
                  type: 'Nivel S/R',
                  description: `Precio $${randomPrice} está cerca del ${randomType.toLowerCase()} en $${randomLevel}\nFuerza: ${strength.toFixed(1)} | Toques: ${touches} | Distancia: ${distance.toFixed(2)}%\nEsta es una alerta de prueba`,
                  data: {
                    price: parseFloat(randomPrice),
                    levelPrice: parseFloat(randomLevel),
                    levelType: randomType.toLowerCase(),
                    strength: strength,
                    touches: touches,
                    distance: distance
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
              🧪 Prueba
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