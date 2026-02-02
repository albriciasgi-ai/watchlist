import React, { useState, useEffect, useRef } from 'react';
import TimeController from './TimeController';
import MiniChart from '../MiniChart';
import OrderManager from './OrderManager';
import TradingControls from './TradingControls';
import PerformancePanel from './PerformancePanel';
import TradeHistory from './TradeHistory';
import TradingDashboard from './dashboard/TradingDashboard';
import PendingOrders from './PendingOrders';
import TimeframeTabs from './TimeframeTabs';
import VolumeProfileSettings from '../VolumeProfileSettings';
import RangeDetectionSettings from '../RangeDetectionSettings';
import RejectionPatternSettings from '../RejectionPatternSettings';
import SupportResistanceSettings from '../SupportResistanceSettings';
import SupportResistance2Settings from '../SupportResistance2Settings';
import VWAPSettings from '../VWAPSettings';
import DoubleTopBottomSettings from '../DoubleTopBottomSettings';
import SwingDetectorSettings from '../SwingDetectorSettings';
import ZoneDetectorTester from '../ZoneDetectorTester';
import { StrategyBuilder, StrategyList, BacktestResults } from '../strategy';
import '../strategy/StrategyBuilder.css';
import '../strategy/BacktestResults.css';
import DrawingToolbar from '../drawing/DrawingToolbar';
import SessionManager from './SessionManager';
import SessionSaveModal from './SessionSaveModal';
import SessionLoadModal from './SessionLoadModal';
import { API_BASE_URL } from '../../config';
import '../../backtesting_styles.css';
import '../drawing/DrawingToolbar.css';

const BacktestingApp = () => {
  // Estado principal
  const [symbol, setSymbol] = useState('');
  const [activeTimeframe, setActiveTimeframe] = useState('15m'); // Tab activo
  const [marketData, setMarketData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(null); // {message, percent, timeframe}
  const [error, setError] = useState(null);
  const [initialized, setInitialized] = useState(false);

  // 🎯 Configuración base de indicadores por timeframe
  // Para 1m y 5m deshabilitamos indicadores pesados por defecto (DTB, Rejection)
  const getDefaultIndicatorStates = (timeframe) => {
    const isSmallTimeframe = timeframe === '1m' || timeframe === '5m';
    return {
      "Volume": true,
      "Volume Profile": true,
      "CVD": true,
      "Open Interest": !isSmallTimeframe, // Deshabilitado en 1m/5m (muchos datos)
      "VWAP": false,
      "Range Detection": true,
      "Rejection Patterns": false,        // Siempre deshabilitado por defecto
      "Double Top/Bottom": false,         // Siempre deshabilitado por defecto
      "Support & Resistance": false,
      "S&R v2": true,
      "Swing Detector": false
    };
  };

  const defaultVpConfig = {
    mode: 'dynamic',
    rowCount: 100,
    valueAreaPercent: 70,
    hideWhenFixedRanges: false,
    showPOC: true,
    showVAH: true,
    showVAL: true
  };

  // 🎯 NUEVO: Estado de cada tab (dibujos y configs independientes)
  const [tabStates, setTabStates] = useState({
    '1m': {
      indicatorStates: getDefaultIndicatorStates('1m'),
      vpConfig: { ...defaultVpConfig },
      vpFixedRange: null,
      rejectionPatternConfig: null
    },
    '5m': {
      indicatorStates: getDefaultIndicatorStates('5m'),
      vpConfig: { ...defaultVpConfig },
      vpFixedRange: null,
      rejectionPatternConfig: null
    },
    '15m': {
      indicatorStates: getDefaultIndicatorStates('15m'),
      vpConfig: { ...defaultVpConfig },
      vpFixedRange: null,
      rejectionPatternConfig: null
    },
    '1h': {
      indicatorStates: getDefaultIndicatorStates('1h'),
      vpConfig: { ...defaultVpConfig },
      vpFixedRange: null,
      rejectionPatternConfig: null
    },
    '4h': {
      indicatorStates: getDefaultIndicatorStates('4h'),
      vpConfig: { ...defaultVpConfig },
      vpFixedRange: null,
      rejectionPatternConfig: null
    }
  });

  // Estado de reproducción
  const [currentTime, setCurrentTime] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [startDate, setStartDate] = useState('2023-01-01'); // 🎯 Fijar en enero 2023 para testing DTB
  const [currentPrice, setCurrentPrice] = useState(null);
  const [simulationStartTime, setSimulationStartTime] = useState(null); // 🎯 NUEVO: Guardar para reutilizar en applyConfig

  // Estado de UI
  const [activePanel, setActivePanel] = useState('trading'); // 'trading', 'performance', 'history'
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false);

  // 🎯 NUEVO: Estado para indicadores (igual que Watchlist)
  const [indicatorStates, setIndicatorStates] = useState({
    "Volume": true,
    "Volume Profile": true,
    "CVD": true,
    "Open Interest": true,
    "VWAP": false,  // Nuevo indicador
    "Range Detection": true,
    "Rejection Patterns": false,  // Opcional (requiere configuración)
    "Double Top/Bottom": false,  // Nuevo indicador
    "Support & Resistance": false,
    "S&R v2": true  // S&R basado en Swing Points (más preciso)
  });

  // 🎯 Estados para modales de configuración de indicadores
  const [showVpSettings, setShowVpSettings] = useState(false);
  const [showRangeDetectionSettings, setShowRangeDetectionSettings] = useState(false);
  const [showRejectionPatternSettings, setShowRejectionPatternSettings] = useState(false);
  const [showSupportResistanceSettings, setShowSupportResistanceSettings] = useState(false);
  const [showSupportResistance2Settings, setShowSupportResistance2Settings] = useState(false);
  const [showVWAPSettings, setShowVWAPSettings] = useState(false);
  const [showDoubleTopBottomSettings, setShowDoubleTopBottomSettings] = useState(false);
  const [showSwingDetectorSettings, setShowSwingDetectorSettings] = useState(false);
  const [showZoneDetectorTester, setShowZoneDetectorTester] = useState(false);
  const [detectedZones, setDetectedZones] = useState([]);

  // 🎯 NUEVO: Estado para Strategy Builder
  const [selectedStrategyId, setSelectedStrategyId] = useState(null);
  const [showStrategyBuilder, setShowStrategyBuilder] = useState(false);
  const [activeStrategy, setActiveStrategy] = useState(null);
  const [backtestResult, setBacktestResult] = useState(null);
  const [showBacktestResults, setShowBacktestResults] = useState(false);

  // 🎯 Configuraciones de indicadores
  const [vpConfig, setVpConfig] = useState({
    mode: 'dynamic',
    rowCount: 100,
    valueAreaPercent: 70,
    hideWhenFixedRanges: false,
    showPOC: true,
    showVAH: true,
    showVAL: true
  });
  const [vpFixedRange, setVpFixedRange] = useState(null);
  const [vpApplyToAll, setVpApplyToAll] = useState(true);
  const [rejectionPatternConfig, setRejectionPatternConfig] = useState(null);

  // 🎯 NUEVO: Estado para sistema de dibujo
  const [currentTool, setCurrentTool] = useState('select');

  // 🎯 NUEVO: Estado para mostrar/ocultar panel de trading (Ctrl+T)
  const [showTradingPanel, setShowTradingPanel] = useState(true);

  // 🎯 NUEVO: Estado para modo pantalla completa
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 🎯 NUEVO: Estados para sistema de sesiones
  const [sessionManager] = useState(() => new SessionManager());
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [currentSessionName, setCurrentSessionName] = useState(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);

  // 🎯 NUEVO: Estados para panel redimensionable y fullscreen por panel
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('backtesting_sidebar_width');
    return saved ? parseInt(saved) : 380;
  });
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);
  const [fullscreenPanel, setFullscreenPanel] = useState(null); // null | 'chart' | 'trading'

  // Referencias
  const timeControllerRef = useRef(null);
  const orderManagerRef = useRef(null);
  const indicatorPanelRef = useRef(null);
  const indicatorManagerRef = useRef(null); // Ref para IndicatorManager del tab activo

  // 🎯 Lista de timeframes disponibles (centralizada)
  const AVAILABLE_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h'];

  // 🎯 NUEVO: Referencias múltiples para cada timeframe
  const indicatorManagerRefs = useRef({
    '1m': null,
    '5m': null,
    '15m': null,
    '1h': null,
    '4h': null
  });
  const miniChartRefs = useRef({
    '1m': null,
    '5m': null,
    '15m': null,
    '1h': null,
    '4h': null
  });

  // 🎯 NUEVO: Guardar posiciones de scroll por tab
  const tabScrollPositions = useRef({
    '1m': 0,
    '5m': 0,
    '15m': 0,
    '1h': 0,
    '4h': 0
  });

  // 🎯 FIX: Referencias para evitar closure stale en handleTimeUpdate
  const marketDataRef = useRef(null);
  const activeTimeframeRef = useRef('15m');

  // 🎯 FIX: Sincronizar refs con valores actuales
  useEffect(() => {
    marketDataRef.current = marketData;
  }, [marketData]);

  useEffect(() => {
    activeTimeframeRef.current = activeTimeframe;
  }, [activeTimeframe]);

  // 🎯 NUEVO: Handlers para divider redimensionable
  useEffect(() => {
    if (!isDraggingDivider) return;

    const handleMouseMove = (e) => {
      const windowWidth = window.innerWidth;
      const newWidth = windowWidth - e.clientX;
      const minWidth = 300;
      const maxWidth = windowWidth * 0.7;

      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingDivider(false);
      localStorage.setItem('backtesting_sidebar_width', sidebarWidth.toString());
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingDivider, sidebarWidth]);

  // 🎯 NUEVO: Función para toggle fullscreen
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      // Entrar a fullscreen
      document.documentElement.requestFullscreen().then(() => {
        setIsFullscreen(true);
        console.log('[BacktestingApp] Modo pantalla completa activado');
      }).catch(err => {
        console.error('[BacktestingApp] Error al entrar en fullscreen:', err);
      });
    } else {
      // Salir de fullscreen
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
        console.log('[BacktestingApp] Modo pantalla completa desactivado');
      }).catch(err => {
        console.error('[BacktestingApp] Error al salir de fullscreen:', err);
      });
    }
  };

  // 🎯 NUEVO: Event listener para T (toggle panel de trading) y Ctrl+F (fullscreen)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Detectar solo T (sin Ctrl) para evitar conflictos con navegador
      // Solo si no hay inputs con foco
      const isInputFocused = document.activeElement.tagName === 'INPUT' ||
                            document.activeElement.tagName === 'TEXTAREA' ||
                            document.activeElement.tagName === 'SELECT';

      // T key: Toggle trading panel
      if (e.key === 't' && !e.ctrlKey && !e.metaKey && !e.altKey && !isInputFocused) {
        e.preventDefault();
        setShowTradingPanel(prev => !prev);
        console.log(`[BacktestingApp] Panel de trading ${!showTradingPanel ? 'mostrado' : 'ocultado'}`);
      }

      // Ctrl+F: Fullscreen
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault(); // Prevenir búsqueda del navegador
        toggleFullscreen();
      }

      // 🎯 NUEVO: Alt+C: Play/Pause reproducción
      if (e.altKey && (e.key === 'c' || e.key === 'C') && !isInputFocused) {
        e.preventDefault();
        if (isPlaying) {
          handlePause();
          console.log(`[BacktestingApp] ⏸️ Pausado con Alt+C`);
        } else {
          handlePlay();
          console.log(`[BacktestingApp] ▶️ Reproduciendo con Alt+C`);
        }
      }

      // 🎯 NUEVO: Ctrl+S: Guardar sesión
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (initialized) {
          setShowSaveModal(true);
          console.log('[BacktestingApp] Abriendo modal de guardar sesión (Ctrl+S)');
        }
      }

      // 🎯 NUEVO: Ctrl+O: Cargar sesión
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        setShowLoadModal(true);
        console.log('[BacktestingApp] Abriendo modal de cargar sesión (Ctrl+O)');
      }

      // 🎯 NUEVO: F key: Toggle fullscreen del gráfico
      if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !isInputFocused) {
        e.preventDefault();
        setFullscreenPanel(prev => prev === 'chart' ? null : 'chart');
        console.log('[BacktestingApp] Toggle fullscreen del gráfico (F)');
      }

      // 🎯 NUEVO: ESC: Salir de fullscreen del panel
      if (e.key === 'Escape' && fullscreenPanel) {
        e.preventDefault();
        setFullscreenPanel(null);
        console.log('[BacktestingApp] Saliendo de fullscreen del panel (ESC)');
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showTradingPanel, isPlaying, initialized, fullscreenPanel]);

  // 🎯 NUEVO: Listener para detectar cuando el usuario sale de fullscreen con ESC
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      console.log(`[BacktestingApp] Fullscreen cambió: ${document.fullscreenElement ? 'activado' : 'desactivado'}`);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // 🎯 DESHABILITADO: Este useEffect causaba problemas al ejecutarse múltiples veces
  // El precálculo ahora se hace SOLO en handleInitialize cuando el usuario inicia la simulación
  // useEffect(() => {
  //   ...
  // }, [marketData]);

  /**
   * Carga datos de backtesting desde el backend
   */
  const loadBacktestingData = async (symbolToLoad, forceRefresh = false) => {
    setLoading(true);
    setError(null);

    try {
      console.log(`[BacktestingApp] Cargando datos para ${symbolToLoad}... (force_refresh: ${forceRefresh})`);

      const url = `${API_BASE_URL}/api/backtesting/bulk-data/${symbolToLoad}${forceRefresh ? '?force_refresh=true' : ''}`;
      const response = await fetch(url);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Error al cargar datos');
      }

      console.log('[BacktestingApp] Datos cargados:', data);
      setMarketData(data);

      // Guardar en IndexedDB para futuras sesiones
      await saveToIndexedDB(symbolToLoad, data);

      return data;

    } catch (err) {
      console.error('[BacktestingApp] Error:', err);
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  /**
   * 🎯 NUEVO: Verifica si hay datos nuevos y actualiza el caché
   */
  const checkForUpdates = async (symbolToCheck) => {
    try {
      console.log(`[BacktestingApp] 🔄 Verificando actualizaciones para ${symbolToCheck}...`);

      const url = `${API_BASE_URL}/api/backtesting/update/${symbolToCheck}`;
      const response = await fetch(url, { method: 'POST' });
      const result = await response.json();

      if (result.success) {
        console.log(`[BacktestingApp] ✅ Actualización completada:`, result);

        // Si hay datos nuevos, actualizar IndexedDB
        if (result.new_candles_added > 0) {
          const updatedData = await loadBacktestingData(symbolToCheck);
          if (updatedData) {
            await saveToIndexedDB(symbolToCheck, updatedData);
          }
        }
      }

      return result;
    } catch (err) {
      console.error('[BacktestingApp] Error al verificar actualizaciones:', err);
      return null;
    }
  };

  /**
   * Guarda datos en IndexedDB
   */
  const saveToIndexedDB = async (symbol, data) => {
    return new Promise((resolve, reject) => {
      const dbName = 'backtestingCache';
      const request = indexedDB.open(dbName, 1);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['marketData'], 'readwrite');
        const store = transaction.objectStore('marketData');

        const saveRequest = store.put({
          symbol: symbol,
          data: data,
          savedAt: Date.now()
        });

        saveRequest.onsuccess = () => {
          console.log(`[IndexedDB] Datos guardados para ${symbol}`);
          resolve();
        };

        saveRequest.onerror = () => reject(saveRequest.error);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('marketData')) {
          const store = db.createObjectStore('marketData', { keyPath: 'symbol' });
          store.createIndex('savedAt', 'savedAt', { unique: false });
        }
      };
    });
  };

  /**
   * Carga datos desde IndexedDB
   * Retorna un objeto con { data, savedAt } o null si no hay datos
   */
  const loadFromIndexedDB = async (symbol) => {
    return new Promise((resolve, reject) => {
      const dbName = 'backtestingCache';
      const request = indexedDB.open(dbName, 1);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains('marketData')) {
          resolve(null);
          return;
        }

        const transaction = db.transaction(['marketData'], 'readonly');
        const store = transaction.objectStore('marketData');
        const getRequest = store.get(symbol);

        getRequest.onsuccess = () => {
          if (getRequest.result) {
            console.log(`[IndexedDB] Datos encontrados para ${symbol}`);
            // Retornar tanto los datos como el timestamp de cuándo se guardaron
            resolve({
              data: getRequest.result.data,
              savedAt: getRequest.result.savedAt
            });
          } else {
            resolve(null);
          }
        };

        getRequest.onerror = () => reject(getRequest.error);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('marketData')) {
          const store = db.createObjectStore('marketData', { keyPath: 'symbol' });
          store.createIndex('savedAt', 'savedAt', { unique: false });
        }
      };
    });
  };

  /**
   * Elimina datos de IndexedDB para un símbolo específico
   */
  const deleteFromIndexedDB = async (symbol) => {
    return new Promise((resolve, reject) => {
      const dbName = 'backtestingCache';
      const request = indexedDB.open(dbName, 1);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains('marketData')) {
          resolve();
          return;
        }

        const transaction = db.transaction(['marketData'], 'readwrite');
        const store = transaction.objectStore('marketData');
        const deleteRequest = store.delete(symbol);

        deleteRequest.onsuccess = () => {
          console.log(`[IndexedDB] Datos eliminados para ${symbol}`);
          resolve();
        };

        deleteRequest.onerror = () => reject(deleteRequest.error);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('marketData')) {
          const store = db.createObjectStore('marketData', { keyPath: 'symbol' });
          store.createIndex('savedAt', 'savedAt', { unique: false });
        }
      };
    });
  };

  /**
   * Inicializa el backtesting con un símbolo
   */
  const handleInitialize = async () => {
    if (!symbol) {
      setError('Por favor ingresa un símbolo');
      return;
    }

    // Intentar cargar desde IndexedDB primero
    const cachedResult = await loadFromIndexedDB(symbol);

    let data;
    let shouldUseCachedData = false;

    if (cachedResult && cachedResult.data) {
      const now = Date.now();
      const cacheAge = now - cachedResult.savedAt;
      const cacheAgeHours = cacheAge / (1000 * 60 * 60);

      console.log(`[BacktestingApp] Datos encontrados en IndexedDB, guardados hace ${cacheAgeHours.toFixed(2)} horas`);

      // 🎯 NUEVO: SIEMPRE usar caché si existe (nunca expira)
      const timeframeData = cachedResult.data.timeframes?.['15m'];
      if (timeframeData && timeframeData.main && timeframeData.main.length > 0) {
        const lastCandle = timeframeData.main[timeframeData.main.length - 1];
        console.log(`[BacktestingApp] Última vela del caché: ${new Date(lastCandle.timestamp).toISOString()}`);
        console.log('[BacktestingApp] ✅ Usando datos de IndexedDB (carga instantánea)');

        shouldUseCachedData = true;
        data = cachedResult.data;
        setMarketData(data);

        // 🎯 NUEVO: Actualizar datos en segundo plano
        checkForUpdates(symbol).then(updateResult => {
          if (updateResult && updateResult.success && updateResult.new_candles_added > 0) {
            console.log(`[BacktestingApp] 🔄 ${updateResult.new_candles_added} velas nuevas disponibles`);
            alert(`✅ Datos actualizados: ${updateResult.new_candles_added} nuevas velas agregadas`);
            // Recargar datos actualizados
            loadBacktestingData(symbol).then(updatedData => {
              if (updatedData) {
                setMarketData(updatedData);
              }
            });
          }
        }).catch(err => {
          console.warn('[BacktestingApp] No se pudo verificar actualizaciones:', err);
        });
      }
    }

    // Si no hay caché válido, descargar datos frescos
    if (!shouldUseCachedData) {
      console.log('[BacktestingApp] Descargando datos del servidor...');
      data = await loadBacktestingData(symbol);
    }

    if (data && data.timeframes && data.timeframes['15m']) {
      const timeframeData = data.timeframes['15m'];
      const firstCandle = timeframeData.main[0];
      const lastCandle = timeframeData.main[timeframeData.main.length - 1];

      // Determinar el simulationStartTime
      // Si el usuario especificó una fecha de inicio, usar esa como simulationStartTime
      // De lo contrario, usar el primer dato del historial
      let simulationStartTime;

      console.log('[BacktestingApp] DEBUG - startDate:', startDate);
      console.log('[BacktestingApp] DEBUG - firstCandle.timestamp:', firstCandle.timestamp, new Date(firstCandle.timestamp).toISOString());
      console.log('[BacktestingApp] DEBUG - lastCandle.timestamp:', lastCandle.timestamp, new Date(lastCandle.timestamp).toISOString());

      if (startDate && startDate.trim() !== '') {
        // Crear fecha en hora local del navegador (medianoche)
        const startTimestamp = new Date(startDate + 'T00:00:00').getTime();

        console.log('[BacktestingApp] DEBUG - startDate input:', startDate);
        console.log('[BacktestingApp] DEBUG - startTimestamp calculado:', startTimestamp, new Date(startTimestamp).toISOString());

        // VALIDACIÓN 1: Verificar que la fecha esté dentro del rango de datos disponibles
        const minDataBuffer = 7 * 24 * 60 * 60 * 1000; // Mínimo 7 días de datos después de la fecha
        const maxAllowedStart = lastCandle.timestamp - minDataBuffer;

        if (startTimestamp < firstCandle.timestamp) {
          setError(`❌ Fecha muy antigua. Los datos inician el ${new Date(firstCandle.timestamp).toLocaleDateString('es-CO')}. Por favor selecciona una fecha posterior.`);
          return;
        }

        if (startTimestamp > maxAllowedStart) {
          const maxDate = new Date(maxAllowedStart).toLocaleDateString('es-CO');
          const lastDate = new Date(lastCandle.timestamp).toLocaleDateString('es-CO');
          setError(`❌ Fecha muy reciente. Los datos terminan el ${lastDate}. Por favor selecciona una fecha anterior al ${maxDate} para tener suficientes datos de simulación.`);
          return;
        }

        // Buscar la primera vela que sea >= a la fecha seleccionada
        const startCandleIndex = timeframeData.main.findIndex(c => c.timestamp >= startTimestamp);

        if (startCandleIndex === -1) {
          // Este caso no debería ocurrir gracias a la validación anterior
          setError('❌ No se encontraron datos para la fecha seleccionada.');
          return;
        }

        // Verificar que haya suficientes velas después de la fecha de inicio
        const remainingCandles = timeframeData.main.length - startCandleIndex;
        const minRequiredCandles = 100; // Mínimo 100 velas para simular

        if (remainingCandles < minRequiredCandles) {
          const suggestedIndex = Math.max(0, timeframeData.main.length - minRequiredCandles - 100);
          const suggestedDate = new Date(timeframeData.main[suggestedIndex].timestamp).toLocaleDateString('es-CO');
          setError(`❌ Solo hay ${remainingCandles} velas disponibles después de esta fecha. Por favor selecciona una fecha anterior (sugerida: ${suggestedDate}).`);
          return;
        }

        // Usar la vela encontrada
        simulationStartTime = timeframeData.main[startCandleIndex].timestamp;
        setSimulationStartTime(simulationStartTime); // 🎯 NUEVO: Guardar para usar en applyConfig
        console.log('[BacktestingApp] ✅ Usando fecha de inicio seleccionada:');
        console.log(`  - Fecha ingresada: ${startDate}`);
        console.log(`  - Timestamp: ${simulationStartTime}`);
        console.log(`  - Fecha real: ${new Date(simulationStartTime).toISOString()}`);
        console.log(`  - Índice de vela: ${startCandleIndex} de ${timeframeData.main.length}`);
        console.log(`  - Velas disponibles para simular: ${remainingCandles}`);
      } else {
        // Sin fecha de inicio - usar una fecha razonable por defecto
        // Buscar la vela más cercana a hace 1 año desde la última vela disponible
        const oneYearAgo = lastCandle.timestamp - (365 * 24 * 60 * 60 * 1000);
        const defaultStartIndex = timeframeData.main.findIndex(c => c.timestamp >= oneYearAgo);

        if (defaultStartIndex !== -1) {
          simulationStartTime = timeframeData.main[defaultStartIndex].timestamp;
          setSimulationStartTime(simulationStartTime); // 🎯 NUEVO: Guardar para usar en applyConfig
          console.log('[BacktestingApp] Sin fecha de inicio especificada, usando hace ~1 año:', new Date(simulationStartTime).toISOString());
        } else {
          // Fallback: usar el primer dato del historial
          simulationStartTime = firstCandle.timestamp;
          setSimulationStartTime(simulationStartTime); // 🎯 NUEVO: Guardar para usar en applyConfig
          console.log('[BacktestingApp] Sin fecha de inicio especificada, usando primer dato:', new Date(simulationStartTime).toISOString());
        }
      }

      // Crear TimeController
      // IMPORTANTE:
      // - startTime = firstCandle.timestamp (para mostrar TODO el historial)
      // - simulationStartTime = fecha donde empieza la simulación
      // - endTime = lastCandle.timestamp
      // - currentTime se inicializará en simulationStartTime
      const controller = new TimeController(
        firstCandle.timestamp,     // startTime: inicio del historial (para mostrar todo)
        lastCandle.timestamp,       // endTime: fin del historial
        '15m',                      // timeframe de referencia (para subdivisiones)
        handleTimeUpdate,           // callback
        simulationStartTime         // simulationStartTime: donde empieza la simulación
      );

      // Inicializar sincronización multi-pestaña
      const sessionId = `${symbol}_multi_${Date.now()}`;
      controller.initSync(sessionId);

      timeControllerRef.current = controller;

      // Crear OrderManager
      if (!orderManagerRef.current) {
        orderManagerRef.current = new OrderManager(10000); // Balance inicial $10,000

        // 🎯 NUEVO: Conectar callback para cuando una orden pendiente se ejecuta
        orderManagerRef.current.onOrderExecuted = (executedOrder) => {
          console.log('[BacktestingApp] Orden pendiente ejecutada:', executedOrder);
          // El popup se mostrará automáticamente en TradingControls a través del callback onOrderCreated
        };

        console.log('[BacktestingApp] OrderManager creado');
      }

      // El currentTime está en simulationStartTime
      setCurrentTime(controller.currentTime);

      // IMPORTANTE: Establecer precio inicial para currentTime
      // Buscar la vela que corresponde exactamente a simulationStartTime
      const startCandleIndex = timeframeData.main.findIndex(c => c.timestamp >= controller.currentTime);

      if (startCandleIndex !== -1) {
        // Usar la vela en simulationStartTime o la inmediatamente anterior
        const candleIndex = startCandleIndex > 0 ? startCandleIndex - 1 : 0;
        const startCandle = timeframeData.main[candleIndex];
        setCurrentPrice(startCandle.close);
        console.log('[BacktestingApp] ✅ Precio inicial establecido:');
        console.log(`  - Precio: ${startCandle.close}`);
        console.log(`  - Fecha de la vela: ${new Date(startCandle.timestamp).toISOString()}`);
        console.log(`  - SimulationStartTime: ${new Date(controller.currentTime).toISOString()}`);
        console.log(`  - Índice de vela: ${candleIndex} de ${timeframeData.main.length}`);
      } else {
        // Fallback: usar la última vela disponible
        const lastCandle = timeframeData.main[timeframeData.main.length - 1];
        setCurrentPrice(lastCandle.close);
        console.log('[BacktestingApp] ⚠️ Precio inicial (fallback - última vela):', lastCandle.close);
      }

      handleTimeUpdate(controller.currentTime);

      // 🎯 NUEVO: PRECALCULAR todos los indicadores para todos los timeframes
      console.log('[BacktestingApp] 🚀 Iniciando precálculo de indicadores para todos los timeframes...');
      console.log(`[BacktestingApp] 📅 simulationStartTime: ${new Date(simulationStartTime).toISOString()}`);
      const precalculateStartTime = Date.now();

      try {
        const precalculateTasks = [];

        // Precalcular para cada timeframe
        for (const tf of AVAILABLE_TIMEFRAMES) {
          const miniChart = miniChartRefs.current[tf];
          const tfData = data.timeframes[tf];

          if (miniChart && miniChart.precalculateIndicators && tfData && tfData.main) {
            console.log(`[BacktestingApp] 📊 Precalculando ${tf} con ${tfData.main.length} velas...`);
            // 🎯 CRÍTICO: Pasar simulationStartTime para evitar sesgo de supervivencia en DTB
            precalculateTasks.push(
              miniChart.precalculateIndicators(tfData.main, simulationStartTime)
                .then(() => {
                  console.log(`[BacktestingApp] ✅ ${tf} precálculo completado`);
                })
                .catch(err => {
                  console.error(`[BacktestingApp] ❌ Error precalculando ${tf}:`, err);
                })
            );
          }
        }

        // Esperar a que todos terminen
        await Promise.all(precalculateTasks);

        const precalculateDuration = ((Date.now() - precalculateStartTime) / 1000).toFixed(2);
        console.log(`[BacktestingApp] ✅ PRECÁLCULO GLOBAL COMPLETADO en ${precalculateDuration}s`);
        console.log(`[BacktestingApp] 🎬 Sistema listo para playback rápido`);

      } catch (error) {
        console.error('[BacktestingApp] ❌ Error en precálculo global:', error);
        // Continuar de todos modos - los indicadores se calcularán on-the-fly si falla
      }

      setInitialized(true);

      console.log('[BacktestingApp] ✅ Inicializado');
      console.log(`  - Mostrando historial desde: ${new Date(firstCandle.timestamp).toISOString()}`);
      console.log(`  - Simulación inicia en: ${new Date(controller.currentTime).toISOString()}`);
    }
  };

  /**
   * Callback cuando el tiempo cambia
   */
  const handleTimeUpdate = (newTime) => {
    console.log(`[BacktestingApp] [ENTRY] handleTimeUpdate called with timestamp: ${newTime} (${new Date(newTime).toISOString()})`);
    setCurrentTime(newTime);

    // 🎯 FIX: Usar refs para acceder a valores actuales (no del closure)
    const currentMarketData = marketDataRef.current;
    const currentActiveTimeframe = activeTimeframeRef.current;

    console.log(`[BacktestingApp] CHECK1: marketData=${!!currentMarketData}, timeframes=${!!currentMarketData?.timeframes}, activeTimeframe=${currentActiveTimeframe}, hasData=${!!currentMarketData?.timeframes?.[currentActiveTimeframe]}`);

    if (currentMarketData && currentMarketData.timeframes && currentMarketData.timeframes[currentActiveTimeframe]) {
      const timeframeData = currentMarketData.timeframes[currentActiveTimeframe];
      console.log(`[BacktestingApp] CHECK2: timeframeData.main.length=${timeframeData.main?.length}`);

      // Buscar la vela más reciente que no exceda currentTime
      const visibleCandles = timeframeData.main.filter(c => c.timestamp <= newTime);
      console.log(`[BacktestingApp] CHECK3: visibleCandles.length=${visibleCandles.length}`);

      if (visibleCandles.length > 0) {
        const lastCandle = visibleCandles[visibleCandles.length - 1];
        setCurrentPrice(lastCandle.close);

        // 🎯 FIX: Actualizar órdenes con el candle completo (high/low/close)
        // Esto permite detectar SL/TP que fueron tocados durante la vela
        if (orderManagerRef.current) {
          orderManagerRef.current.updateOrders(lastCandle, newTime);
        }

        // 🎯 NUEVO: Actualizar fecha de playback para Double Top/Bottom (chunks progresivos)
        // Esto permite que nuevos patrones aparezcan a medida que avanza el playback
        const miniChart = miniChartRefs.current[currentActiveTimeframe];
        const indicatorManager = miniChart?.getIndicatorManager?.();
        console.log(`[BacktestingApp] 🔍 DEBUG updateDTB: activeTimeframe=${currentActiveTimeframe}, hasMiniChart=${!!miniChart}, hasManager=${!!indicatorManager}, hasMethod=${!!(indicatorManager?.updateDTBPlaybackDate)}`);

        if (indicatorManager && indicatorManager.updateDTBPlaybackDate) {
          console.log(`[BacktestingApp] ✅ Calling updateDTBPlaybackDate with timestamp: ${newTime} (${new Date(newTime).toISOString()})`);
          indicatorManager.updateDTBPlaybackDate(newTime);
        } else {
          console.warn(`[BacktestingApp] ⚠️ Cannot update DTB: manager=${!!indicatorManager}, method=${!!(indicatorManager?.updateDTBPlaybackDate)}`);
        }

        // 🎯 Actualizar también el Swing Detector para playback
        if (indicatorManager && indicatorManager.updateSwingPlaybackTime) {
          indicatorManager.updateSwingPlaybackTime(newTime);
        }

        // 🎯 Actualizar S&R para playback (evita sesgo de supervivencia)
        if (indicatorManager && indicatorManager.updateSRPlaybackTime) {
          indicatorManager.updateSRPlaybackTime(newTime);
        }
      }
    }
  };

  /**
   * Controles de reproducción
   */
  const handlePlay = () => {
    console.log('[BacktestingApp] handlePlay clicked', {
      hasController: !!timeControllerRef.current,
      currentTime,
      isPlaying
    });
    if (timeControllerRef.current) {
      timeControllerRef.current.play();
      setIsPlaying(true);
    } else {
      console.error('[BacktestingApp] No hay timeController');
    }
  };

  const handlePause = () => {
    console.log('[BacktestingApp] handlePause clicked');
    if (timeControllerRef.current) {
      timeControllerRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleStop = () => {
    console.log('[BacktestingApp] handleStop clicked');
    if (timeControllerRef.current) {
      timeControllerRef.current.stop();
      setIsPlaying(false);
      // Stop ya no resetea el tiempo, solo pausa
      // El currentTime se mantiene en la posición actual
    }
  };

  const handleSpeedChange = (speed) => {
    if (timeControllerRef.current) {
      timeControllerRef.current.setSpeed(speed);
      setPlaybackSpeed(speed);
    }
  };

  /**
   * 🎯 NUEVO: Actualizar currentPrice cuando currentTime cambia
   * Esto asegura que TradingControls siempre tenga el precio correcto
   */
  useEffect(() => {
    if (!marketData || !currentTime) return;

    const timeframeData = marketData.timeframes?.[activeTimeframe];
    if (!timeframeData || !timeframeData.main) return;

    // Buscar la vela más reciente que no exceda currentTime
    const visibleCandles = timeframeData.main.filter(c => c.timestamp <= currentTime);

    if (visibleCandles.length > 0) {
      const lastCandle = visibleCandles[visibleCandles.length - 1];
      setCurrentPrice(lastCandle.close);

      // 🎯 FIX: Actualizar órdenes con el candle completo (high/low/close)
      if (orderManagerRef.current) {
        orderManagerRef.current.updateOrders(lastCandle, currentTime);
      }
    }
  }, [currentTime, marketData, activeTimeframe]);

  /**
   * 🎯 NUEVO: Cerrar panel de indicadores al hacer click fuera
   */
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showIndicatorPanel && indicatorPanelRef.current && !indicatorPanelRef.current.contains(event.target)) {
        setShowIndicatorPanel(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showIndicatorPanel]);

  /**
   * Cleanup al desmontar
   */
  useEffect(() => {
    return () => {
      if (timeControllerRef.current) {
        timeControllerRef.current.destroy();
      }
    };
  }, []);

  /**
   * 🎯 Handlers para abrir modales de configuración
   */
  const handleOpenVpSettings = () => {
    setShowVpSettings(true);
  };

  const handleVpConfigChange = (newConfig) => {
    setVpConfig(newConfig);
  };

  const handleVpFixedRangeChange = (startTimestamp, endTimestamp) => {
    setVpFixedRange({
      start: startTimestamp,
      end: endTimestamp,
      applyToAll: vpApplyToAll,
      symbol: symbol
    });
  };

  const handleOpenRangeDetectionSettings = (indicatorManager, candles) => {
    indicatorManagerRef.current = indicatorManager;
    setShowRangeDetectionSettings(true);
  };

  const handleOpenRejectionPatternSettings = (indicatorManager) => {
    indicatorManagerRef.current = indicatorManager;
    setShowRejectionPatternSettings(true);
  };

  const handleOpenSupportResistanceSettings = (indicatorManager) => {
    indicatorManagerRef.current = indicatorManager;
    setShowSupportResistanceSettings(true);
  };

  const handleOpenVWAPSettings = (indicatorManager) => {
    indicatorManagerRef.current = indicatorManager;
    setShowVWAPSettings(true);
  };

  const handleOpenDoubleTopBottomSettings = (indicatorManager) => {
    indicatorManagerRef.current = indicatorManager;
    setShowDoubleTopBottomSettings(true);
  };

  const handleOpenSwingDetectorSettings = (indicatorManager) => {
    indicatorManagerRef.current = indicatorManager;
    setShowSwingDetectorSettings(true);
  };

  const handleRejectionPatternConfigChange = (config) => {
    setRejectionPatternConfig(config);
  };

  /**
   * 🎯 NUEVO: Handlers para Tabs de Timeframes
   */
  const handleTabChange = (newTimeframe) => {
    console.log('[BacktestingApp] Cambiando de tab:', activeTimeframe, '→', newTimeframe);

    if (newTimeframe === activeTimeframe) return;

    // 🔧 FIX: Sincronizar dibujos del tab actual a todos los demás tabs
    // Esto permite que los dibujos se vean en todos los timeframes (como TradingView)
    const currentMiniChart = miniChartRefs.current[activeTimeframe];
    if (currentMiniChart && currentMiniChart.getDrawings) {
      const drawings = currentMiniChart.getDrawings();
      console.log(`[BacktestingApp] Sincronizando ${drawings.length} dibujos a todos los tabs`);

      // Cargar los mismos dibujos en todos los tabs (skipSync = true para evitar loop)
      AVAILABLE_TIMEFRAMES.forEach(tf => {
        if (tf !== activeTimeframe) {
          const miniChart = miniChartRefs.current[tf];
          if (miniChart && miniChart.loadDrawings) {
            miniChart.loadDrawings(drawings, true); // true = skipSync
          }
        }
      });
    }

    // Cambiar tab activo
    setActiveTimeframe(newTimeframe);

    // Forzar redibujado del nuevo tab después de cambiar
    setTimeout(() => {
      const miniChart = miniChartRefs.current[newTimeframe];
      if (miniChart && miniChart.forceRedraw) {
        miniChart.forceRedraw();
        console.log(`[BacktestingApp] Tab ${newTimeframe} redibujado`);
      }
    }, 50);
  };

  /**
   * 🔧 FIX: Handler para sincronizar dibujos en tiempo real entre tabs
   */
  const handleDrawingsChange = (shapes, sourceInterval) => {
    console.log(`[BacktestingApp] Sincronizando ${shapes.length} dibujos desde ${sourceInterval} a otros tabs`);

    // Cargar los mismos dibujos en todos los tabs (excepto el origen)
    // skipSync = true para evitar loop infinito
    AVAILABLE_TIMEFRAMES.forEach(tf => {
      if (tf !== sourceInterval) {
        const miniChart = miniChartRefs.current[tf];
        if (miniChart && miniChart.loadDrawings) {
          miniChart.loadDrawings(shapes, true); // true = skipSync
        }
      }
    });
  };

  /**
   * 🎯 Cerrar todos los modales al cambiar de tab
   */
  useEffect(() => {
    setShowVpSettings(false);
    setShowRangeDetectionSettings(false);
    setShowRejectionPatternSettings(false);
    setShowSupportResistanceSettings(false);
    setShowVWAPSettings(false);
    setShowDoubleTopBottomSettings(false);
    setShowSwingDetectorSettings(false);
  }, [activeTimeframe]);

  /**
   * 🎯 NUEVO: Obtener contador de órdenes por timeframe
   */
  const getOrderCountsByTimeframe = () => {
    if (!orderManagerRef.current) {
      return { '1m': 0, '5m': 0, '15m': 0, '1h': 0, '4h': 0 };
    }

    // Por ahora, mostrar todas las órdenes abiertas en todos los tabs
    // En el futuro, podríamos trackear en qué timeframe se creó cada orden
    const openCount = orderManagerRef.current.getOpenOrders().length;

    return {
      '1m': openCount,
      '5m': openCount,
      '15m': openCount,
      '1h': openCount,
      '4h': openCount
    };
  };

  /**
   * 🎯 NUEVO: Handlers para Drawing Tools (Undo/Redo/Clear) - Multi-timeframe
   */
  const handleUndo = () => {
    const miniChart = miniChartRefs.current[activeTimeframe];
    if (miniChart && miniChart.undo) {
      miniChart.undo();
      console.log(`[BacktestingApp] Undo ejecutado en ${activeTimeframe}`);
    }
  };

  const handleRedo = () => {
    const miniChart = miniChartRefs.current[activeTimeframe];
    if (miniChart && miniChart.redo) {
      miniChart.redo();
      console.log(`[BacktestingApp] Redo ejecutado en ${activeTimeframe}`);
    }
  };

  const handleClearAll = () => {
    const miniChart = miniChartRefs.current[activeTimeframe];
    if (miniChart && miniChart.clearAll) {
      if (window.confirm(`¿Seguro que quieres borrar todos los dibujos del timeframe ${activeTimeframe}?`)) {
        miniChart.clearAll();
        console.log(`[BacktestingApp] Clear all ejecutado en ${activeTimeframe}`);
      }
    }
  };

  /**
   * 🎯 NUEVO: Sistema de Sesiones - Capturar estado completo de TODOS los tabs
   */
  const captureCurrentState = () => {
    console.log('[BacktestingApp] Capturando estado de sesión (multi-timeframe)...');

    // Capturar estado de cada tab (dibujos y configs independientes)
    const tabsState = {};
    let totalDrawings = 0;

    AVAILABLE_TIMEFRAMES.forEach(tf => {
      const miniChart = miniChartRefs.current[tf];
      const drawings = miniChart?.getDrawings?.() || [];
      totalDrawings += drawings.length;

      tabsState[tf] = {
        drawings: { shapes: drawings },
        indicatorStates: tabStates[tf]?.indicatorStates || {},
        vpConfig: tabStates[tf]?.vpConfig || {},
        vpFixedRange: tabStates[tf]?.vpFixedRange || null,
        rejectionPatternConfig: tabStates[tf]?.rejectionPatternConfig || null
      };

      console.log(`[BacktestingApp] Tab ${tf} - Dibujos: ${drawings.length}`);
    });

    // Obtener estado de órdenes (global, compartido entre todos los tabs)
    const orderManagerState = orderManagerRef.current?.exportToJSON() || null;
    console.log('[BacktestingApp] Órdenes totales:', orderManagerState?.orders?.length || 0);

    const state = {
      sessionId: currentSessionId || `session_${symbol}_${Date.now()}`,
      sessionName: currentSessionName || `Sesión ${new Date().toLocaleDateString('es-CO')}`,
      createdAt: Date.now(),
      lastModified: Date.now(),
      symbol,
      timeframe: 'multi', // Para compatibilidad con índice de IndexedDB
      activeTimeframe, // Tab que estaba activo
      startDate,

      // Estado de simulación (compartido)
      simulationState: {
        currentTime,
        currentPrice,
        isPlaying,
        playbackSpeed
      },

      // Estado de órdenes (global)
      orderManagerState,

      // Estado de cada tab (3 timeframes)
      tabs: tabsState
    };

    console.log('[BacktestingApp] Estado capturado completo:', {
      symbol: state.symbol,
      activeTimeframe: state.activeTimeframe,
      totalDibujos: totalDrawings,
      ordenes: state.orderManagerState?.orders?.length || 0,
      tabs: Object.keys(state.tabs)
    });

    return state;
  };

  /**
   * 🎯 NUEVO: Sistema de Sesiones - Restaurar estado de TODOS los tabs
   */
  const restoreSession = async (session) => {
    try {
      console.log('[BacktestingApp] Restaurando sesión (multi-timeframe):', session.sessionName);

      // Validar que sea el mismo símbolo
      if (session.symbol !== symbol) {
        const confirmChange = window.confirm(
          `Esta sesión es para ${session.symbol}.\n` +
          `Actualmente estás en ${symbol}.\n\n` +
          `¿Reinicializar con el símbolo de la sesión?`
        );

        if (confirmChange) {
          setSymbol(session.symbol);
          setStartDate(session.startDate || '');
          setInitialized(false);
          // Guardar sesión para cargar después de reinicializar
          localStorage.setItem('pendingSessionLoad', JSON.stringify(session));
          return;
        } else {
          return;
        }
      }

      // Restaurar tab activo
      if (session.activeTimeframe) {
        setActiveTimeframe(session.activeTimeframe);
        console.log('[BacktestingApp] Tab activo restaurado:', session.activeTimeframe);
      }

      // Restaurar estado de simulación (global)
      if (timeControllerRef.current && session.simulationState) {
        timeControllerRef.current.currentTime = session.simulationState.currentTime;
        setCurrentTime(session.simulationState.currentTime);
        setCurrentPrice(session.simulationState.currentPrice);
        setPlaybackSpeed(session.simulationState.playbackSpeed);

        if (session.simulationState.playbackSpeed !== 1) {
          timeControllerRef.current.setSpeed(session.simulationState.playbackSpeed);
        }

        if (timeControllerRef.current.onTimeUpdate) {
          timeControllerRef.current.onTimeUpdate(session.simulationState.currentTime);
        }

        console.log('[BacktestingApp] Tiempo de simulación restaurado:', new Date(session.simulationState.currentTime).toISOString());
      }

      // Restaurar órdenes (global)
      if (orderManagerRef.current && session.orderManagerState) {
        orderManagerRef.current.importFromJSON(session.orderManagerState);
        console.log('[BacktestingApp] Órdenes restauradas:', {
          open: orderManagerRef.current.openOrders.length,
          closed: orderManagerRef.current.closedOrders.length,
          pending: orderManagerRef.current.pendingOrders.length
        });
      }

      // Restaurar estado de cada tab
      if (session.tabs) {
        // 🔧 FIX: Solo restaurar dibujos del tab activo
        // La sincronización automática los copiará a los demás tabs
        const activeTabData = session.tabs[activeTimeframe];
        if (activeTabData && activeTabData.drawings?.shapes) {
          const miniChart = miniChartRefs.current[activeTimeframe];
          if (miniChart) {
            const shapesCount = activeTabData.drawings.shapes.length;
            if (shapesCount > 0) {
              // NO usar skipSync - queremos que se sincronice a otros tabs
              miniChart.loadDrawings(activeTabData.drawings.shapes, false);
              console.log(`[BacktestingApp] ✅ ${shapesCount} dibujos restaurados en tab ${activeTimeframe} (se sincronizarán a otros tabs)`);
            }
          }
        }

        // Restaurar configuraciones de todos los tabs
        AVAILABLE_TIMEFRAMES.forEach(tf => {
          const tabData = session.tabs[tf];
          if (tabData) {
            setTabStates(prev => ({
              ...prev,
              [tf]: {
                indicatorStates: tabData.indicatorStates || {},
                vpConfig: tabData.vpConfig || {},
                vpFixedRange: tabData.vpFixedRange || null,
                rejectionPatternConfig: tabData.rejectionPatternConfig || null
              }
            }));
          }
        });
      } else {
        // Compatibilidad con sesiones antiguas (formato single-tab)
        console.warn('[BacktestingApp] Sesión en formato antiguo (single-tab), convirtiendo...');

        if (session.drawings?.shapes) {
          const tf = session.activeTimeframe || session.timeframe || '15m';
          const miniChart = miniChartRefs.current[tf];
          if (miniChart) {
            miniChart.loadDrawings(session.drawings.shapes);
            console.log(`[BacktestingApp] Dibujos legacy restaurados en tab ${tf}`);
          }
        }
      }

      // Actualizar estado de sesión actual
      setCurrentSessionId(session.sessionId);
      setCurrentSessionName(session.sessionName);

      console.log('[BacktestingApp] ✅ Sesión restaurada exitosamente:', session.sessionName);
      alert(`✅ Sesión cargada: ${session.sessionName}`);
    } catch (error) {
      console.error('[BacktestingApp] Error al restaurar sesión:', error);
      alert(`❌ Error al restaurar sesión: ${error.message}`);
    }
  };

  /**
   * 🎯 NUEVO: Handler para guardar sesión
   */
  const handleSessionSaved = (sessionData) => {
    setCurrentSessionId(sessionData.sessionId);
    setCurrentSessionName(sessionData.sessionName);
    setAutoSaveEnabled(sessionManager.autoSaveInterval !== null);
    console.log('[BacktestingApp] Sesión guardada y registrada:', sessionData.sessionName);
  };

  /**
   * Renderizar vista de configuración inicial
   */
  if (!initialized) {
    return (
      <div className="backtesting-container">
        <div className="backtesting-setup">
          <h1>Backtesting Engine</h1>
          <p className="subtitle">Simula operaciones con datos históricos del mercado</p>

          {error && (
            <div className="error-message">
              ⚠️ {error}
            </div>
          )}

          <div className="setup-form">
            <div className="form-group">
              <label>Símbolo</label>
              <input
                type="text"
                placeholder="BTCUSDT"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                disabled={loading}
              />
            </div>

            {/* 🎯 Timeframe selector eliminado - ahora se cargan los 3 timeframes automáticamente */}

            <div className="form-group">
              <label>Fecha de Inicio (opcional)</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={loading}
              />
              <small style={{ color: '#666', fontSize: '12px', marginTop: '5px', display: 'block' }}>
                📅 Sin fecha = inicia hace ~1 año. Los datos históricos cubren ~3 años de información.
              </small>
            </div>

            <button
              className="btn-primary"
              onClick={handleInitialize}
              disabled={loading || !symbol}
            >
              {loading ? 'Cargando datos...' : 'Inicializar Backtesting'}
            </button>

            {loading && (
              <div className="loading-indicator">
                <div className="spinner"></div>
                <p>Descargando datos históricos para 5 timeframes...</p>
                {loadingProgress ? (
                  <>
                    <p className="loading-progress-message">{loadingProgress.message}</p>
                    <div className="progress-bar-container">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${loadingProgress.percent || 0}%` }}
                      />
                    </div>
                    <p className="small-text">{loadingProgress.percent || 0}% completado</p>
                  </>
                ) : (
                  <p className="small-text">Esto puede tomar 1-2 minutos (1m y 5m tienen muchos datos)</p>
                )}
                <div className="loading-timeframes-info" style={{ marginTop: '10px', fontSize: '11px', color: '#888' }}>
                  <div>⚡ 1m: 525,600 velas (1 año)</div>
                  <div>🔥 5m: 315,360 velas (3 años)</div>
                  <div>📊 15m/1h/4h: ~17,500 velas c/u (2 años)</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /**
   * Renderizar vista principal de backtesting
   */
  return (
    <div className="backtesting-container">
      <div className="backtesting-header">
        <div className="header-info">
          <h2>{symbol} - Multi-Timeframe</h2>
          {marketData && marketData.metadata && (
            <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
              📅 Datos: {new Date(marketData.metadata.date_range.start).toLocaleDateString('es-CO')} - {new Date(marketData.metadata.date_range.end).toLocaleDateString('es-CO')}
              <button
                onClick={async () => {
                  const confirmed = window.confirm('¿Actualizar datos históricos desde Bybit? Esto puede tardar 30-60 segundos y eliminará todos los cachés.');
                  if (confirmed) {
                    try {
                      setLoading(true);
                      setError(null);

                      console.log('[BacktestingApp] ====== INICIANDO ACTUALIZACIÓN COMPLETA ======');

                      // 1. Eliminar caché del backend
                      console.log('[BacktestingApp] Paso 1/4: Eliminando caché del backend...');
                      const deleteResponse = await fetch(`${API_BASE_URL}/api/backtesting/cache/${symbol}`, {
                        method: 'DELETE'
                      });
                      const deleteResult = await deleteResponse.json();
                      console.log('[BacktestingApp] Backend caché eliminado:', deleteResult);

                      // 2. Eliminar datos de IndexedDB
                      console.log('[BacktestingApp] Paso 2/4: Eliminando caché de IndexedDB...');
                      await deleteFromIndexedDB(symbol);

                      // 3. Limpiar localStorage también
                      console.log('[BacktestingApp] Paso 3/4: Limpiando localStorage...');
                      localStorage.removeItem(`backtesting_${symbol}`);

                      // 4. Descargar datos frescos desde Bybit con force_refresh
                      console.log('[BacktestingApp] Paso 4/4: Descargando datos frescos desde Bybit...');
                      const freshData = await loadBacktestingData(symbol, true);

                      if (freshData && freshData.metadata) {
                        console.log('[BacktestingApp] ✅ DATOS ACTUALIZADOS:');
                        console.log(`  - Inicio: ${freshData.metadata.date_range.start}`);
                        console.log(`  - Fin: ${freshData.metadata.date_range.end}`);
                        console.log(`  - Cached at: ${freshData.metadata.cached_at_colombia}`);
                      }

                      // 5. Recargar página para aplicar cambios
                      console.log('[BacktestingApp] Recargando página en 2 segundos...');
                      setTimeout(() => {
                        window.location.reload();
                      }, 2000);
                    } catch (err) {
                      console.error('[BacktestingApp] ❌ Error al actualizar:', err);
                      setError('Error al actualizar datos: ' + err.message);
                      setLoading(false);
                    }
                  }
                }}
                style={{
                  marginLeft: '8px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  background: '#4CAF50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer'
                }}
                title="Descargar datos actualizados desde Bybit"
              >
                🔄 Actualizar
              </button>
            </div>
          )}
          <div className="current-time">
            {currentTime && new Date(currentTime).toLocaleString('es-CO', {
              timeZone: 'America/Bogota',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
          {currentPrice && (
            <div className="current-price">
              Precio: ${currentPrice.toFixed(2)}
            </div>
          )}
        </div>

        <div className="playback-controls">
          <button
            className={`btn-control ${isPlaying ? 'active' : ''}`}
            onClick={isPlaying ? handlePause : handlePlay}
            title={isPlaying ? 'Pausar' : 'Reproducir'}
          >
            {isPlaying ? '⏸️' : '▶️'}
          </button>

          <button
            className="btn-control"
            onClick={handleStop}
            title="Detener"
          >
            ⏹️
          </button>

          <div className="speed-control">
            <label>Velocidad:</label>
            <select
              value={playbackSpeed}
              onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
            >
              <option value="0.5">0.5x</option>
              <option value="1">1x</option>
              <option value="20">20x</option>
              <option value="40">40x</option>
              <option value="60">60x</option>
              <option value="80">80x</option>
              <option value="100">100x</option>
              <option value="200">200x</option>
              <option value="300">300x</option>
              <option value="400">400x</option>
              <option value="500">500x</option>
              <option value="600">600x</option>
              <option value="700">700x</option>
              <option value="800">800x</option>
              <option value="900">900x</option>
              <option value="1000">1000x</option>
              <option value="2000">2000x</option>
              <option value="3000">3000x</option>
              <option value="4000">4000x</option>
              <option value="5000">5000x</option>
              <option value="6000">6000x</option>
              <option value="7000">7000x</option>
              <option value="8000">8000x</option>
              <option value="9000">9000x</option>
              <option value="10000">10000x</option>
            </select>
          </div>

          <div className="indicator-selector" ref={indicatorPanelRef} style={{
            position: 'relative',
            display: 'inline-block',
            marginLeft: '10px'
          }}>
            <button
              className="btn-secondary"
              onClick={() => setShowIndicatorPanel(!showIndicatorPanel)}
              title="Seleccionar indicadores"
              style={{
                background: Object.values(tabStates[activeTimeframe]?.indicatorStates || {}).filter(v => v).length > 0 ? '#4CAF50' : '#666',
                padding: '6px 12px'
              }}
            >
              📊 Indicadores ({Object.values(tabStates[activeTimeframe]?.indicatorStates || {}).filter(v => v).length})
            </button>

            {showIndicatorPanel && (
              <div
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '5px',
                  background: 'white',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  padding: '10px',
                  minWidth: '250px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  zIndex: 1000
                }}
              >
                <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#333' }}>
                  Indicadores ({activeTimeframe})
                </h4>
                {Object.entries(tabStates[activeTimeframe]?.indicatorStates || {}).map(([name, enabled]) => {
                  const settingsMap = {
                    'Volume Profile': () => setShowVpSettings(true),
                    'Range Detection': () => setShowRangeDetectionSettings(true),
                    'Rejection Patterns': () => setShowRejectionPatternSettings(true),
                    'Support & Resistance': () => setShowSupportResistanceSettings(true),
                    'S&R v2': () => setShowSupportResistance2Settings(true),
                    'VWAP': () => setShowVWAPSettings(true),
                    'Double Top/Bottom': () => setShowDoubleTopBottomSettings(true),
                    'Swing Detector': () => setShowSwingDetectorSettings(true)
                  };

                  const hasSettings = name in settingsMap;

                  return (
                    <label
                      key={name}
                      style={{
                        display: 'block',
                        padding: '6px 0',
                        cursor: 'pointer',
                        fontSize: '13px',
                        color: '#333'
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => {
                          e.stopPropagation();
                          setTabStates(prev => ({
                            ...prev,
                            [activeTimeframe]: {
                              ...prev[activeTimeframe],
                              indicatorStates: {
                                ...prev[activeTimeframe].indicatorStates,
                                [name]: e.target.checked
                              }
                            }
                          }));
                        }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ marginRight: '8px' }}
                      />
                      {name}

                      {hasSettings && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            // 🎯 FIX v3: Obtener el indicatorManager con logs de debug
                            const miniChart = miniChartRefs.current[activeTimeframe];
                            console.log(`[Settings] Abriendo config para ${name}:`, {
                              activeTimeframe,
                              hasMiniChart: !!miniChart,
                              miniChartKeys: Object.keys(miniChartRefs.current),
                              hasGetIndicatorManager: !!miniChart?.getIndicatorManager
                            });
                            const manager = miniChart?.getIndicatorManager?.();
                            console.log(`[Settings] Manager obtenido:`, !!manager);
                            if (manager) {
                              indicatorManagerRef.current = manager;
                            } else {
                              // Si no hay manager, mostrar error y no abrir el modal
                              console.warn(`[Settings] No se encontró IndicatorManager para ${activeTimeframe}`);
                              alert(`Error: El gráfico no está completamente cargado. Por favor espere unos segundos e intente de nuevo.`);
                              return; // No abrir el modal si no hay manager
                            }
                            // Abrir el modal
                            settingsMap[name]();
                          }}
                          style={{
                            marginLeft: '8px',
                            cursor: 'pointer',
                            fontSize: '12px',
                            opacity: 0.7,
                            transition: 'opacity 0.2s',
                            display: 'inline'
                          }}
                          onMouseEnter={(e) => e.target.style.opacity = '1'}
                          onMouseLeave={(e) => e.target.style.opacity = '0.7'}
                          title={`Configurar ${name}`}
                        >
                          ⚙️
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <button
            className="btn-secondary"
            onClick={() => setShowSaveModal(true)}
            title="Guardar sesión (Ctrl+S)"
            style={{
              background: currentSessionId ? '#4CAF50' : 'transparent',
              color: currentSessionId ? '#fff' : '#666'
            }}
          >
            💾 Guardar
          </button>

          <button
            className="btn-secondary"
            onClick={() => setShowLoadModal(true)}
            title="Cargar sesión (Ctrl+O)"
          >
            📂 Cargar
          </button>

          <button
            className="btn-secondary"
            onClick={() => setInitialized(false)}
            title="Cambiar configuración"
          >
            ⚙️ Configurar
          </button>

          <button
            className="btn-secondary"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Salir de pantalla completa (Ctrl+F o ESC)" : "Pantalla completa (Ctrl+F)"}
            style={{
              background: isFullscreen ? '#667eea' : 'transparent',
              color: isFullscreen ? '#fff' : '#666'
            }}
          >
            {isFullscreen ? '⛶ Salir' : '⛶ Fullscreen'}
          </button>

          <button
            className="btn-secondary"
            onClick={() => setShowTradingPanel(prev => !prev)}
            title={showTradingPanel ? "Ocultar panel (T)" : "Mostrar panel (T)"}
            style={{
              background: showTradingPanel ? '#667eea' : 'transparent',
              color: showTradingPanel ? '#fff' : '#666'
            }}
          >
            {showTradingPanel ? '📊 Panel' : '📊 Panel'}
          </button>

          <button
            className="btn-secondary"
            onClick={() => setFullscreenPanel(prev => prev === 'chart' ? null : 'chart')}
            title={fullscreenPanel === 'chart' ? "Restaurar layout" : "Maximizar gráfico (F)"}
            style={{
              background: fullscreenPanel === 'chart' ? '#FF9800' : 'transparent',
              color: fullscreenPanel === 'chart' ? '#fff' : '#666'
            }}
          >
            {fullscreenPanel === 'chart' ? '🔳 Chart' : '⛶ Chart'}
          </button>

          <button
            className="btn-secondary"
            onClick={() => setFullscreenPanel(prev => prev === 'trading' ? null : 'trading')}
            title={fullscreenPanel === 'trading' ? "Restaurar layout" : "Maximizar panel trading"}
            style={{
              background: fullscreenPanel === 'trading' ? '#4CAF50' : 'transparent',
              color: fullscreenPanel === 'trading' ? '#fff' : '#666'
            }}
          >
            {fullscreenPanel === 'trading' ? '🔳 Trading' : '⛶ Trading'}
          </button>
        </div>
      </div>

      <div
        className="backtesting-main-wrapper"
        style={{
          position: 'relative',
          display: fullscreenPanel ? 'block' : 'flex'
        }}
      >
        {/* 🎯 NUEVO: Divider redimensionable */}
        {showTradingPanel && !fullscreenPanel && (
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              setIsDraggingDivider(true);
            }}
            style={{
              position: 'absolute',
              right: sidebarWidth,
              top: 0,
              bottom: 0,
              width: '4px',
              cursor: 'ew-resize',
              backgroundColor: isDraggingDivider ? '#2196F3' : 'transparent',
              zIndex: 1000,
              transition: isDraggingDivider ? 'none' : 'background-color 0.2s'
            }}
            onMouseEnter={(e) => {
              if (!isDraggingDivider) {
                e.currentTarget.style.backgroundColor = '#E0E0E0';
              }
            }}
            onMouseLeave={(e) => {
              if (!isDraggingDivider) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          />
        )}

        <div
          className="backtesting-main"
          style={{
            flex: fullscreenPanel === 'chart' ? '1' : (fullscreenPanel === 'trading' ? '0' : '1'),
            display: fullscreenPanel === 'trading' ? 'none' : 'flex'
          }}
        >
          {/* 🎯 NUEVO: Tabs de timeframes */}
          <TimeframeTabs
            activeTimeframe={activeTimeframe}
            onTabChange={handleTabChange}
            orderCounts={getOrderCountsByTimeframe()}
          />

          {/* 🎯 NUEVO: Barra de herramientas de dibujo */}
          <DrawingToolbar
            selectedTool={currentTool}
            onToolChange={setCurrentTool}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onClearAll={handleClearAll}
          />

          {/* 🎯 NUEVO: Contenedor de tabs - 5 MiniCharts (uno por timeframe) */}
          {/* Días por timeframe: 1m=365, 5m=1095, 15m/1h/4h=730 */}
          <div className="timeframes-container">
            {['1m', '5m', '15m', '1h', '4h'].map(tf => {
              // Mapeo de días por timeframe
              const daysMap = {
                '1m': 365,    // 1 año de datos (525,600 velas)
                '5m': 1095,   // 3 años de datos (315,360 velas)
                '15m': 730,   // 2 años de datos
                '1h': 730,    // 2 años de datos
                '4h': 730     // 2 años de datos
              };
              const tfDays = daysMap[tf] || 730;

              return (
              <div
                key={tf}
                className="timeframe-panel"
                style={{ display: activeTimeframe === tf ? 'block' : 'none' }}
              >
                <MiniChart
                  ref={el => miniChartRefs.current[tf] = el}
                  symbol={symbol}
                  interval={tf}
                  days={tfDays}
                  indicatorStates={tabStates[tf]?.indicatorStates}
                  backtestingMode={true}
                  backtestingData={marketData}
                  currentTime={currentTime}
                  vpConfig={tabStates[tf]?.vpConfig}
                  vpFixedRange={tabStates[tf]?.vpFixedRange}
                  onOpenVpSettings={handleOpenVpSettings}
                  onOpenRangeDetectionSettings={handleOpenRangeDetectionSettings}
                  onOpenRejectionPatternSettings={handleOpenRejectionPatternSettings}
                  onOpenSupportResistanceSettings={handleOpenSupportResistanceSettings}
                  onOpenVWAPSettings={handleOpenVWAPSettings}
                  onOpenDoubleTopBottomSettings={handleOpenDoubleTopBottomSettings}
                  onOpenSwingDetectorSettings={handleOpenSwingDetectorSettings}
                  rejectionPatternConfig={tabStates[tf]?.rejectionPatternConfig}
                  currentTool={currentTool}
                  onToolChange={setCurrentTool}
                  onRequestPause={handlePause}
                  onRequestTimeChange={(newTime) => {
                    // 🎯 FIX: Permitir navegación a cualquier timestamp del playback
                    console.log(`[BacktestingApp] 🕐 onRequestTimeChange: ${new Date(newTime).toISOString()}`);
                    handlePause(); // Pausar primero
                    if (timeControllerRef.current) {
                      timeControllerRef.current.currentTime = newTime;
                    }
                    setCurrentTime(newTime);
                  }}
                  onDrawingsChange={handleDrawingsChange}
                />
              </div>
            );
            })}
          </div>
        </div>

        {/* 🎯 NUEVO: Panel oculto/visible con Ctrl+T + Fullscreen */}
        <div
          className={`backtesting-sidebar ${!showTradingPanel ? 'hidden' : ''}`}
          style={{
            width: fullscreenPanel === 'trading' ? '100%' : (fullscreenPanel === 'chart' ? '0' : `${sidebarWidth}px`),
            display: fullscreenPanel === 'chart' ? 'none' : 'flex'
          }}
        >
          {/* Panel Tabs */}
          <div className="sidebar-tabs">
            <button
              className={`tab-btn ${activePanel === 'trading' ? 'active' : ''}`}
              onClick={() => setActivePanel('trading')}
            >
              📊 Trading
            </button>
            <button
              className={`tab-btn ${activePanel === 'performance' ? 'active' : ''}`}
              onClick={() => setActivePanel('performance')}
            >
              📈 Métricas
            </button>
            <button
              className={`tab-btn ${activePanel === 'history' ? 'active' : ''}`}
              onClick={() => setActivePanel('history')}
            >
              📋 Historial
            </button>
            <button
              className={`tab-btn ${activePanel === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActivePanel('dashboard')}
            >
              📊 Dashboard
            </button>
            <button
              className={`tab-btn ${activePanel === 'zones' ? 'active' : ''}`}
              onClick={() => setActivePanel('zones')}
            >
              🎯 Zonas
            </button>
            <button
              className={`tab-btn ${activePanel === 'strategy' ? 'active' : ''}`}
              onClick={() => setActivePanel('strategy')}
            >
              🧠 Estrategia
            </button>
          </div>

          {/* Panel Content */}
          <div className="sidebar-content">
            {activePanel === 'trading' && (
              <>
                <PendingOrders
                  orderManager={orderManagerRef.current}
                  currentPrice={currentPrice}
                />
                <TradingControls
                  orderManager={orderManagerRef.current}
                  currentPrice={currentPrice}
                  currentTime={currentTime}
                  onOrderCreated={(order) => {
                    console.log('[BacktestingApp] Orden creada:', order);

                    // 🎯 NUEVO: Crear caja TP/SL automática solo para market orders con SL y TP
                    if (order && order.type === 'market' && (order.stopLoss || order.takeProfit)) {
                      const miniChart = miniChartRefs.current[activeTimeframe];
                      if (miniChart && miniChart.addTPSLBox) {
                        miniChart.addTPSLBox(
                          order.entryPrice,
                          order.openTime || currentTime,
                          order.side, // 'long' o 'short'
                          order.stopLoss,
                          order.takeProfit,
                          5 // 5 velas de ancho
                        );
                      }
                    }
                  }}
                />
              </>
            )}

            {activePanel === 'performance' && (
              <PerformancePanel
                orderManager={orderManagerRef.current}
                currentPrice={currentPrice}
                currentTime={currentTime}
              />
            )}

            {activePanel === 'history' && (
              <TradeHistory orderManager={orderManagerRef.current} />
            )}

            {activePanel === 'dashboard' && (
              <TradingDashboard
                orderManager={orderManagerRef.current}
                symbol={symbol}
              />
            )}

            {activePanel === 'zones' && (
              <ZoneDetectorTester
                symbol={symbol}
                interval={activeTimeframe}
                playbackStartTime={simulationStartTime}
                onZonesDetected={(zones) => {
                  setDetectedZones(zones);
                  console.log(`[BacktestingApp] 🎯 ${zones.length} zonas detectadas, activeTimeframe=${activeTimeframe}`);
                  console.log(`[BacktestingApp] 🎯 Zonas:`, zones.slice(0, 2)); // Log primeras 2 zonas

                  // Las zonas se renderizarán en el chart
                  const miniChart = miniChartRefs.current[activeTimeframe];
                  console.log(`[BacktestingApp] 🎯 miniChart ref:`, !!miniChart, `setZones:`, !!miniChart?.setZones);

                  if (miniChart && miniChart.setZones) {
                    miniChart.setZones(zones);
                    // Forzar redibujado después de establecer zonas
                    if (miniChart.forceRedraw) {
                      setTimeout(() => miniChart.forceRedraw(), 100);
                    }
                  } else {
                    console.error(`[BacktestingApp] ❌ No se pudo establecer zonas - miniChart o setZones no disponible`);
                  }
                }}
                // 🎯 NUEVO: Callback para centrar el chart en una zona seleccionada
                onZoneClick={(zone) => {
                  console.log(`[BacktestingApp] 🎯 Navegando a zona #${detectedZones.indexOf(zone) + 1}:`, zone.id);
                  const miniChart = miniChartRefs.current[activeTimeframe];
                  if (miniChart && miniChart.centerOnTimestamp) {
                    // Centrar en el punto medio de la zona
                    const midTimestamp = Math.floor((zone.start_timestamp + zone.end_timestamp) / 2);
                    miniChart.centerOnTimestamp(midTimestamp);
                    console.log(`[BacktestingApp] 🎯 Centrando en timestamp: ${midTimestamp} (${new Date(midTimestamp).toISOString()})`);
                  } else {
                    console.warn(`[BacktestingApp] ⚠️ centerOnTimestamp no disponible en miniChart`);
                  }
                }}
                // 🎯 NUEVO: Callback para limpiar zonas del chart
                onClearZones={() => {
                  console.log(`[BacktestingApp] 🧹 Limpiando zonas detectadas`);
                  setDetectedZones([]);
                  const miniChart = miniChartRefs.current[activeTimeframe];
                  if (miniChart && miniChart.clearZones) {
                    miniChart.clearZones();
                  }
                }}
              />
            )}

            {activePanel === 'strategy' && (
              <div className="strategy-panel">
                {showBacktestResults && backtestResult ? (
                  <BacktestResults
                    result={backtestResult}
                    onClose={() => setShowBacktestResults(false)}
                    onViewTrade={(trade) => {
                      // Navegar al timestamp del trade en el chart
                      if (trade.entry_time && timeControllerRef.current) {
                        timeControllerRef.current.seekToTime(trade.entry_time);
                        console.log('[BacktestingApp] Navegando al trade:', trade.id);
                      }
                    }}
                  />
                ) : showStrategyBuilder ? (
                  <StrategyBuilder
                    strategyId={selectedStrategyId}
                    symbol={symbol}
                    currentTime={currentTime}
                    candles={marketData?.timeframes?.[activeTimeframe]?.main || []}
                    onSave={(strategy) => {
                      setActiveStrategy(strategy);
                      setShowStrategyBuilder(false);
                      console.log('[BacktestingApp] Estrategia guardada:', strategy.name);
                    }}
                    onClose={() => setShowStrategyBuilder(false)}
                    onRunBacktest={(result) => {
                      setBacktestResult(result);
                      setShowBacktestResults(true);
                      console.log('[BacktestingApp] Backtest completado:', result.metrics);
                    }}
                  />
                ) : (
                  <div className="strategy-list-container">
                    {backtestResult && (
                      <button
                        className="view-results-btn"
                        onClick={() => setShowBacktestResults(true)}
                      >
                        Ver últimos resultados ({backtestResult.metrics?.total_trades || 0} trades)
                      </button>
                    )}
                    <StrategyList
                      selectedId={selectedStrategyId}
                      onSelect={(id) => setSelectedStrategyId(id)}
                      onEdit={(id) => {
                        setSelectedStrategyId(id);
                        setShowStrategyBuilder(true);
                      }}
                      onNew={() => {
                        setSelectedStrategyId(null);
                        setShowStrategyBuilder(true);
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 🎯 Modales de configuración de indicadores */}
      {showVpSettings && (
        <div className="modal-overlay" onClick={() => setShowVpSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Configuración Volume Profile</h3>
              <button
                className="modal-close-btn"
                onClick={() => setShowVpSettings(false)}
                style={{ background: '#dc3545', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}
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
                currentSymbol={symbol}
              />
            </div>
          </div>
        </div>
      )}

      {showRangeDetectionSettings && indicatorManagerRef.current && (
        <div className="modal-overlay" onClick={() => setShowRangeDetectionSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <RangeDetectionSettings
              symbol={symbol}
              indicatorManager={indicatorManagerRef.current}
              candles={marketData?.timeframes?.[activeTimeframe]?.main || []}
              onClose={() => setShowRangeDetectionSettings(false)}
            />
          </div>
        </div>
      )}

      {showRejectionPatternSettings && indicatorManagerRef.current && (
        <RejectionPatternSettings
          symbol={symbol}
          indicatorManager={indicatorManagerRef.current}
          onConfigChange={handleRejectionPatternConfigChange}
          onClose={() => setShowRejectionPatternSettings(false)}
          initialConfig={rejectionPatternConfig}
        />
      )}

      {showSupportResistanceSettings && indicatorManagerRef.current && (
        <SupportResistanceSettings
          symbol={symbol}
          indicatorManager={indicatorManagerRef.current}
          onClose={() => setShowSupportResistanceSettings(false)}
        />
      )}

      {showSupportResistance2Settings && indicatorManagerRef.current && (
        <SupportResistance2Settings
          symbol={symbol}
          indicatorManager={indicatorManagerRef.current}
          onClose={() => setShowSupportResistance2Settings(false)}
        />
      )}

      {showVWAPSettings && indicatorManagerRef.current && (
        <div className="modal-overlay" onClick={() => setShowVWAPSettings(false)} style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            maxWidth: '600px',
            maxHeight: '80vh',
            width: '90%',
            overflow: 'auto',
            position: 'relative',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
          }}>
            <button
              onClick={() => setShowVWAPSettings(false)}
              style={{
                position: 'sticky',
                top: '8px',
                right: '8px',
                float: 'right',
                background: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                fontSize: '20px',
                cursor: 'pointer',
                zIndex: 1001,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold'
              }}
              title="Cerrar"
            >
              ×
            </button>
            <div style={{ padding: '20px' }}>
              <VWAPSettings
                config={indicatorManagerRef.current.getIndicatorConfig('VWAP') || {}}
                onConfigChange={async (newConfig) => {
                  // 🎯 CRÍTICO: Aplicar config y resetear caché de VWAP
                  await indicatorManagerRef.current.applyConfig('VWAP', newConfig);

                  // 🎯 CRÍTICO: Resetear caché del VWAP para forzar recalculo
                  const vwapIndicator = indicatorManagerRef.current.indicators.find(ind => ind.name === 'VWAP');
                  if (vwapIndicator) {
                    vwapIndicator._lastCalculatedLength = 0;
                    vwapIndicator._calculationValid = false;
                    console.log(`[BacktestingApp] 🔄 Caché del VWAP reseteado después de cambio de config`);
                  }

                  // 🎯 CRÍTICO: Forzar redibujado del chart para que se vean los cambios
                  const miniChart = miniChartRefs.current[activeTimeframe];
                  if (miniChart && miniChart.forceRedraw) {
                    miniChart.forceRedraw();
                    console.log(`[BacktestingApp] ✅ Chart redibujado después de cambio de config VWAP`);
                  }
                }}
                currentSymbol={symbol}
                interval={activeTimeframe}
                onClose={() => setShowVWAPSettings(false)}
              />
            </div>
          </div>
        </div>
      )}

      {showDoubleTopBottomSettings && indicatorManagerRef.current && (
        <div className="modal-overlay" onClick={() => setShowDoubleTopBottomSettings(false)} style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            maxWidth: '700px',
            maxHeight: '85vh',
            width: '90%',
            overflow: 'auto',
            position: 'relative',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
          }}>
            <button
              onClick={() => setShowDoubleTopBottomSettings(false)}
              style={{
                position: 'sticky',
                top: '8px',
                right: '8px',
                float: 'right',
                background: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                fontSize: '20px',
                cursor: 'pointer',
                zIndex: 1001,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold'
              }}
              title="Cerrar"
            >
              ×
            </button>
            <div style={{ padding: '20px' }}>
              <DoubleTopBottomSettings
                symbol={symbol}
                initialConfig={indicatorManagerRef.current.getIndicatorConfig('Double Top/Bottom')}
                onConfigChange={async (newConfig) => {
                  // 🎯 Pasar velas directamente a applyConfig para precálculo con nueva configuración
                  const candles = marketData?.timeframes?.[activeTimeframe]?.main;

                  if (candles && candles.length > 0) {
                    console.log(`[BacktestingApp] 📊 Aplicando config DTB con ${candles.length} velas...`);
                    console.log(`[BacktestingApp] 📅 simulationStartTime: ${new Date(simulationStartTime).toISOString()}`);

                    // 🎯 CRÍTICO: Pasar simulationStartTime para evitar sesgo de supervivencia
                    await indicatorManagerRef.current.applyConfig('Double Top/Bottom', newConfig, candles, simulationStartTime);

                    // 🎯 CRÍTICO: Forzar redibujado del gráfico toggle el estado
                    console.log(`[BacktestingApp] 🔄 Forzando redibujado después de aplicar config DTB...`);

                    // Primero desactivar temporalmente
                    setTabStates(prev => ({
                      ...prev,
                      [activeTimeframe]: {
                        ...prev[activeTimeframe],
                        indicatorStates: {
                          ...prev[activeTimeframe].indicatorStates,
                          'Double Top/Bottom': false
                        }
                      }
                    }));

                    // Luego reactivar con el valor correcto (después de un pequeño delay para garantizar re-render)
                    setTimeout(() => {
                      setTabStates(prev => ({
                        ...prev,
                        [activeTimeframe]: {
                          ...prev[activeTimeframe],
                          indicatorStates: {
                            ...prev[activeTimeframe].indicatorStates,
                            'Double Top/Bottom': newConfig.enabled
                          }
                        }
                      }));
                    }, 50);
                  } else {
                    // Fallback sin velas (modo normal, no backtesting)
                    await indicatorManagerRef.current.applyConfig('Double Top/Bottom', newConfig);
                  }
                }}
                onClose={() => setShowDoubleTopBottomSettings(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Modal de Swing Detector Settings */}
      {showSwingDetectorSettings && indicatorManagerRef.current && (
        <div className="modal-overlay" onClick={() => setShowSwingDetectorSettings(false)} style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            maxWidth: '500px',
            maxHeight: '85vh',
            width: '90%',
            overflow: 'auto',
            position: 'relative',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
          }}>
            <button
              onClick={() => setShowSwingDetectorSettings(false)}
              style={{
                position: 'sticky',
                top: '8px',
                right: '8px',
                float: 'right',
                background: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                fontSize: '20px',
                cursor: 'pointer',
                zIndex: 1001,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold'
              }}
              title="Cerrar"
            >
              ×
            </button>
            <SwingDetectorSettings
              symbol={symbol}
              config={indicatorManagerRef.current.getIndicatorConfig('Swing Detector')}
              onConfigChange={async (newConfig) => {
                await indicatorManagerRef.current.applyConfig('Swing Detector', newConfig);

                // Forzar redibujado del chart
                const miniChart = miniChartRefs.current[activeTimeframe];
                if (miniChart && miniChart.forceRedraw) {
                  miniChart.forceRedraw();
                }
              }}
              onClose={() => setShowSwingDetectorSettings(false)}
            />
          </div>
        </div>
      )}

      {/* 🎯 NUEVO: Modales de sistema de sesiones */}
      {showSaveModal && (
        <SessionSaveModal
          sessionManager={sessionManager}
          currentSession={currentSessionId ? {
            sessionId: currentSessionId,
            sessionName: currentSessionName
          } : null}
          getStateCallback={captureCurrentState}
          onClose={() => setShowSaveModal(false)}
          onSaved={handleSessionSaved}
        />
      )}

      {showLoadModal && (
        <SessionLoadModal
          sessionManager={sessionManager}
          currentSymbol={symbol}
          currentTimeframe={activeTimeframe}
          onClose={() => setShowLoadModal(false)}
          onLoad={restoreSession}
          onImport={(importedSession) => {
            console.log('[BacktestingApp] Sesión importada:', importedSession.sessionName);
          }}
        />
      )}
    </div>
  );
};

export default BacktestingApp;
