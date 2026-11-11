import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import TimeController from './TimeController';
import MiniChart from '../MiniChart';
import OrderManager, { tradeLabel } from './OrderManager';
import { TF_MS, candlesToSettle, lastClosedIndex, priceAt, tickAlreadySettled } from './replayClock';
import { withoutSubdivisions } from './marketData';
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
import OIVolumeConfluenceSettings from '../OIVolumeConfluenceSettings';
import OrderFlowSettings from '../OrderFlowSettings';
import FVGSettings from '../FVGSettings';
import LiquidationsSettings from '../LiquidationsSettings';
import OrderFlowElementsSettings from '../OrderFlowElementsSettings';
import OrderFlowSetupsSettings from '../OrderFlowSetupsSettings';
import VPPeriodicSettings from '../VPPeriodicSettings';
import ResponseVolumeSettings from '../ResponseVolumeSettings';
import DrawingToolbar from '../drawing/DrawingToolbar';
import DrawingSidebar from '../drawing/DrawingSidebar'; // 🎯 OPTIMIZACIÓN UI: Sidebar vertical
import { useUiTheme } from '../useUiTheme.js'; // Estilo Nítido
import { isNewTheme } from '../uiTheme.js';
import ThemeSettings from '../ThemeSettings.jsx';
import { VP_FACTORY } from '../indicators/VolumeProfileIndicator.js';
import { Icon } from '../uiIcons.jsx';
import FootprintSidebar from './FootprintSidebar'; // 🎯 Order Flow Footprints
import SessionManager from './SessionManager';
import SessionSaveModal from './SessionSaveModal';
import ObserverPanel from './ObserverPanel';
import PopupWindow, { openPopup } from './PopupWindow';
import { openReplayChannel, secondaryChartUrl } from './replayChannel.js';
import { fetchBlindStart, rangesInUse, recordCancel, recordClose, recordFill, recordImage, recordOrder } from './observer.js';
import { blindAnchor, blindScale, isBlind, maskDate, priceText, pricesHidden, scaleFromCandles, setBlindAnchor, setBlindScale } from './blindClock.js';
import { CaptureHold, exitCaptureTime, exitCapturesDue, tradeBoundaries } from './tradeJournal.js';
import { boxesFollowOrders, latestFreeBox } from './orderPlan.js';
import { drawingsForOrder } from './tradeContext.js';
import { takeLevels } from '../indicators/analysisLevels.js';
import SessionLoadModal from './SessionLoadModal';
import { API_BASE_URL } from '../../config';
import '../../backtesting_styles.css';
import '../drawing/DrawingToolbar.css';
import '../drawing/DrawingSidebar.css'; // 🎯 OPTIMIZACIÓN UI

const OBSERVER_NOTICE_MS = 8000;
const SCREEN_UPDATE_MS = 100; // Cada cuánto llega la hora simulada a la pantalla mientras reproduce

const BacktestingApp = () => {
  // Estado principal
  const [symbol, setSymbol] = useState('');
  const [activeTimeframe, setActiveTimeframe] = useState('15m'); // Tab activo
  const [marketData, setMarketData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(null); // {message, percent, timeframe}
  const [error, setError] = useState(null);
  const [initialized, setInitialized] = useState(false);
  const [downloadingTimeframes, setDownloadingTimeframes] = useState(new Set()); // Timeframes descargándose en background

  // 🎯 Configuración base de indicadores por timeframe
  // Para 1m y 5m deshabilitamos indicadores pesados por defecto (DTB, Rejection)
  const getDefaultIndicatorStates = (timeframe) => {
    const isSmallTimeframe = timeframe === '1m' || timeframe === '5m';
    return {
      "Volume Delta": true,
      "Volume Profile": true,
      "CVD": false,
      "Open Interest": true, // Habilitado en todos los timeframes (backend usa intervalo OI adaptativo)
      "OI-Volume Confluence": true, // 🎯 Confluencia OI-Volumen (muestra cuando movimientos son fuertes/débiles)
      "Order Flow": false, // 🎯 Order Flow con Footprints (overlays + sidebar)
      "FVG": false, // Fair value gaps abiertos
      "VP Periodic": false, // Un perfil por sesión
      "Volumen de Respuesta": false, // Velas principales de la tendencia contra las de la retracción
      "Liquidaciones": false, // Zonas donde se liquidó mucho dinero, cerca del precio
      "Elementos OF": false, // Elementos de Orderflows Unlocked con los trades reales
      "VWAP": false,
      "Range Detection": false,
      "Rejection Patterns": false,        // Siempre deshabilitado por defecto
      "Double Top/Bottom": false,         // Siempre deshabilitado por defecto
      "Support & Resistance": false,
      "S&R v2": false,
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
      rejectionPatternConfig: null,
      oiMode: 'histogram'
    },
    '5m': {
      indicatorStates: getDefaultIndicatorStates('5m'),
      vpConfig: { ...defaultVpConfig },
      vpFixedRange: null,
      rejectionPatternConfig: null,
      oiMode: 'histogram'
    },
    '15m': {
      indicatorStates: getDefaultIndicatorStates('15m'),
      vpConfig: { ...defaultVpConfig },
      vpFixedRange: null,
      rejectionPatternConfig: null,
      oiMode: 'histogram'
    },
    '1h': {
      indicatorStates: getDefaultIndicatorStates('1h'),
      vpConfig: { ...defaultVpConfig },
      vpFixedRange: null,
      rejectionPatternConfig: null,
      oiMode: 'histogram'
    },
    '4h': {
      indicatorStates: getDefaultIndicatorStates('4h'),
      vpConfig: { ...defaultVpConfig },
      vpFixedRange: null,
      rejectionPatternConfig: null,
      oiMode: 'histogram'
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
  const [showThemeSettings, setShowThemeSettings] = useState(false); // Modal "Estilo y colores"
  // 🎯 OPTIMIZACIÓN UI: Estado para menú dropdown compacto de acciones
  const [showActionsMenu, setShowActionsMenu] = useState(false);

  // 🎯 NUEVO: Estado para indicadores (igual que Watchlist)
  const [indicatorStates, setIndicatorStates] = useState({
    "Volume Delta": true,
    "Volume Profile": true,
    "CVD": false,
    "Open Interest": true,
    "OI-Volume Confluence": true,  // 🎯 Confluencia OI-Volumen
    "VWAP": false,  // Nuevo indicador
    "Range Detection": false,
    "Rejection Patterns": false,  // Opcional (requiere configuración)
    "Double Top/Bottom": false,  // Nuevo indicador
    "Support & Resistance": false,
    "S&R v2": false  // S&R basado en Swing Points (más preciso)
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
  const [showOIVolumeConfluenceSettings, setShowOIVolumeConfluenceSettings] = useState(false);
  const [showOrderFlowSettings, setShowOrderFlowSettings] = useState(false);
  const [showFVGSettings, setShowFVGSettings] = useState(false);
  const [showVPPeriodicSettings, setShowVPPeriodicSettings] = useState(false);
  const [showResponseVolumeSettings, setShowResponseVolumeSettings] = useState(false);
  const [showLiquidationsSettings, setShowLiquidationsSettings] = useState(false);
  const [showOFElementsSettings, setShowOFElementsSettings] = useState(false);
  const [showOFSetupsSettings, setShowOFSetupsSettings] = useState(false);
  const [chartShapes, setChartShapes] = useState([]); // Dibujos del gráfico, para ofrecer la caja TP/SL

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
  // OPTIMIZACIÓN UI: Por defecto oculto para maximizar espacio del gráfico
  const [showTradingPanel, setShowTradingPanel] = useState(false);

  // 🎯 OPTIMIZACIÓN UI: Estados para sidebar de dibujo (D para toggle: expandido → colapsado → oculto)
  const [drawingSidebarCollapsed, setDrawingSidebarCollapsed] = useState(false);
  useUiTheme(); // Se vuelve a pintar al cambiar el estilo
  const [drawingSidebarHidden, setDrawingSidebarHidden] = useState(false);

  // 🎯 Order Flow: Estado para footprints anclados (hasta 10)
  const [pinnedFootprints, setPinnedFootprints] = useState([]);

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

  // Observador: fecha oculta y aviso al terminar una orden
  const [blindRequested, setBlindRequested] = useState(false);
  const [blindActive, setBlindActive] = useState(false);
  const [observerRevision, setObserverRevision] = useState(0);
  const [observerNotice, setObserverNotice] = useState(null);
  const [observerUnread, setObserverUnread] = useState(0);
  const [observerPopup, setObserverPopup] = useState(null); // Ventana aparte del Observador, abierta desde su pestaña
  const maxSimTimeRef = useRef(0); // Hasta dónde llegó la simulación: una orden anterior ya conoce el futuro
  const rejectionConfigRef = useRef(null); // Último ajuste aplicado: el modal avisa en cada dibujo

  // Referencias
  const timeControllerRef = useRef(null);
  const orderManagerRef = useRef(null);
  const indicatorPanelRef = useRef(null);
  const indicatorManagerRef = useRef(null); // Ref para IndicatorManager del tab activo
  const sessionIdRef = useRef(null); // Sesión que recibe los trades y sus imágenes
  const sessionSaveRef = useRef(Promise.resolve()); // Los guardados van uno detrás de otro
  const latestRef = useRef({}); // Valores de este render, para eventos que se conectan una sola vez
  latestRef.current.symbol = symbol;

  // 🎯 FIX CRÍTICO: Refs para almacenar handlers actualizables (soluciona problema HMR)
  // Los listeners se adjuntan UNA VEZ en handleInitialize, pero llaman a estos refs
  // que son actualizados por useEffect cada vez que cambian las dependencias
  const eventHandlersRef = useRef({
    tradeClosed: null,
    tradeOpened: null,
    orderExecuted: null
  });

  /** Sesión de los trades. La primera operación la crea aunque no se haya guardado a mano */
  const ensureSessionId = () => {
    if (!sessionIdRef.current) {
      sessionIdRef.current = `session_${latestRef.current.symbol}_${Date.now()}`;
      setCurrentSessionId(sessionIdRef.current);
    }
    return sessionIdRef.current;
  };

  /** Deja en la sesión el estado actual de órdenes, dibujos y tiempo */
  const saveTradeSession = () => {
    sessionSaveRef.current = sessionSaveRef.current
      .then(() => sessionManager.mergeSession({ ...latestRef.current.captureCurrentState(), sessionId: ensureSessionId() }))
      .catch(error => console.error('[BacktestingApp] No se pudo guardar la sesión:', error));
    return sessionSaveRef.current;
  };

  /** Deja la imagen en el registro y avisa al Observador */
  const linkImage = (order, kind, image) => recordImage(order, kind, {
    path: image.screenshotPath,
    sim_time: image.screenshotSimTime,
    frame: image.screenshotFrame,
    markers: image.screenshotMarkers || []
  }).then(() => setObserverRevision(value => value + 1));

  /** Toma la imagen de la entrada y la deja en el trade */
  const captureEntry = async (order, miniChart, onCopied) => {
    try {
      const image = await miniChart.captureScreenshot(ensureSessionId(), order.id, { keepInView: order.executedAt ?? order.entryTime, context: true, onCopied, items: order.analysisItems || [] });
      Object.assign(order, image);
      linkImage(order, 'entry', image);
    } catch (error) {
      console.error(`[BacktestingApp] No se pudo capturar la entrada del trade #${order.id}:`, error);
    }
    await saveTradeSession();
  };

  /** Toma lo que había a la vista al dejar una orden en espera, con más velas: su llenado puede tardar días */
  const captureDecision = async (order, miniChart, onCopied) => {
    try {
      const image = await miniChart.captureScreenshot(ensureSessionId(), order.id, { context: true, onCopied, items: order.analysisItems || [] });
      order.decisionScreenshotPath = image.screenshotPath;
      order.decisionScreenshotSimTime = image.screenshotSimTime;
      order.decisionScreenshotFrame = image.screenshotFrame;
      linkImage(order, 'decision', image);
    } catch (error) {
      console.error(`[BacktestingApp] No se pudo capturar la decisión del trade #${order.id}:`, error);
    }
    await saveTradeSession();
  };

  /** Toma la imagen del trade terminado, con lo que pasó después, y la deja en el trade */
  const captureExit = async (order, miniChart) => {
    if (!miniChart?.isShown?.()) return; // Con el gráfico oculto espera a que vuelva
    order.exitCaptureAt = null; // Una sola vez, aunque el tiempo siga avanzando
    try {
      const image = await miniChart.captureScreenshot(ensureSessionId(), order.id, {
        showFrom: order.executedAt ?? order.entryTime,
        items: order.analysisItems || []
      });
      order.exitScreenshotPath = image.screenshotPath;
      order.exitScreenshotTimestamp = image.screenshotTimestamp;
      order.exitScreenshotMetadata = image.screenshotMetadata;
      order.exitScreenshotSimTime = image.screenshotSimTime;
      order.exitScreenshotFrame = image.screenshotFrame;
      linkImage(order, 'exit', image);
    } catch (error) {
      console.error(`[BacktestingApp] No se pudo capturar el cierre del trade #${order.id}:`, error);
    }
    await saveTradeSession();
  };

  // 🎯 FIX CRÍTICO: useEffect para actualizar handlers (estos se llaman desde los listeners adjuntos en handleInitialize)
  // Este useEffect se ejecuta cada vez que cambia activeTimeframe o currentSessionId,
  // actualizando los handlers con closures frescos que capturan el estado actual
  useEffect(() => {
    console.log('[BacktestingApp] 🔧 Actualizando event handlers del OrderManager...');

    const redrawCharts = () => AVAILABLE_TIMEFRAMES.forEach(tf => miniChartRefs.current[tf]?.redraw?.());

    // Handler para cuando se cierra un trade
    eventHandlersRef.current.tradeClosed = (event) => {
      const { order } = event;

      recordClose(order).then(() => {
        setObserverRevision(value => value + 1);
        if (order.observerId) {
          setObserverNotice(order);
          setObserverUnread(value => value + 1);
        }
      });

      redrawCharts();

      // Extender caja TP/SL hasta el timestamp de cierre
      if (order.tpslBoxId) {
        miniChartRefs.current[activeTimeframe]?.extendTPSLBox?.(order.tpslBoxId, order.exitTime);
      }

      order.exitCaptureAt = exitCaptureTime(order.exitTime, TF_MS[activeTimeframe]);
      saveTradeSession();
    };

    // Handler para cuando se abre un trade: de mercado al crearlo, limit o stop al ejecutarse
    eventHandlersRef.current.tradeOpened = (event) => {
      const { order } = event;

      redrawCharts();
      // El marco se elige al tomar la imagen: durante la espera se puede cambiar de pestaña
      captureHold.run(release => captureEntry(order, miniChartRefs.current[activeTimeframeRef.current], release));
    };

    // Una orden pendiente se ejecutó: el evento tradeOpened llega justo después
    eventHandlersRef.current.orderExecuted = (executedOrder) => {
      recordFill(executedOrder);

      if (executedOrder.tpslBoxId) {
        miniChartRefs.current[activeTimeframe]?.anchorTPSLBox?.(executedOrder.tpslBoxId, executedOrder.executedAt, executedOrder.executedPrice);
      } else if (executedOrder.stopLoss || executedOrder.takeProfit) {
        executedOrder.tpslBoxId = miniChartRefs.current[activeTimeframe]?.addTPSLBox?.(
          executedOrder.entryPrice,
          executedOrder.executedAt,
          executedOrder.side, // 'long' o 'short'
          executedOrder.stopLoss,
          executedOrder.takeProfit,
          5 // 5 velas de ancho
        ) ?? null;
      }
    };

    console.log('[BacktestingApp] ✅ Event handlers actualizados (tradeClosed, tradeOpened, orderExecuted)');

    // NO hay cleanup - los handlers se actualizan pero los listeners permanecen adjuntos
  }, [activeTimeframe, currentSessionId]); // Re-ejecutar cuando cambian estas dependencias

  // 🎯 Lista de timeframes disponibles (centralizada)
  const AVAILABLE_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h'];

  // 🎯 Configuración esperada de días por timeframe (debe coincidir con BACKTESTING_CONFIG del backend)
  const DAYS_BY_TIMEFRAME = { '1m': 730, '5m': 1825, '15m': 1825, '1h': 1825, '4h': 1825 };
  const INTERVAL_MINUTES = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240 };

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
  const settledTimeRef = useRef(null); // Hasta dónde ya se revisaron las órdenes
  const lastScreenUpdateRef = useRef(0); // Última vez que la hora simulada llegó a la pantalla
  const captureHold = useMemo(() => new CaptureHold(() => timeControllerRef.current), []);

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

      // 🎯 OPTIMIZACIÓN UI: D key: Ciclar estados del sidebar (expandido → colapsado → oculto → expandido)
      if (e.key === 'd' && !e.ctrlKey && !e.metaKey && !e.altKey && !isInputFocused) {
        e.preventDefault();

        if (drawingSidebarHidden) {
          // Oculto → Expandido
          setDrawingSidebarHidden(false);
          setDrawingSidebarCollapsed(false);
          console.log('[BacktestingApp] Sidebar de dibujo (D): oculto → expandido');
        } else if (drawingSidebarCollapsed) {
          // Colapsado → Oculto
          setDrawingSidebarHidden(true);
          console.log('[BacktestingApp] Sidebar de dibujo (D): colapsado → oculto');
        } else {
          // Expandido → Colapsado
          setDrawingSidebarCollapsed(true);
          console.log('[BacktestingApp] Sidebar de dibujo (D): expandido → colapsado');
        }
      }

      // 🎯 NUEVO: F key: Toggle fullscreen del gráfico
      if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !isInputFocused) {
        e.preventDefault();
        setFullscreenPanel(prev => prev === 'chart' ? null : 'chart');
        console.log('[BacktestingApp] Toggle fullscreen del gráfico (F)');
      }

      // 🎯 NUEVO: Shift+T: Toggle fullscreen del panel de trading
      if (e.key === 'T' && e.shiftKey && !e.ctrlKey && !e.metaKey && !isInputFocused) {
        e.preventDefault();
        setFullscreenPanel(prev => prev === 'trading' ? null : 'trading');
        console.log('[BacktestingApp] Toggle fullscreen del panel de trading (Shift+T)');
      }

      // 🎯 NUEVO: ESC: Salir de fullscreen del panel y ocultar panel trading
      if (e.key === 'Escape') {
        e.preventDefault();
        if (fullscreenPanel) {
          setFullscreenPanel(null);
          console.log('[BacktestingApp] Saliendo de fullscreen del panel (ESC)');
        }
        if (showTradingPanel) {
          setShowTradingPanel(false);
          console.log('[BacktestingApp] Ocultando panel de trading (ESC)');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showTradingPanel, drawingSidebarCollapsed, isPlaying, initialized, fullscreenPanel]);

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
   * @param {string} symbolToLoad - Símbolo a cargar
   * @param {boolean} forceRefresh - Si true, fuerza re-descarga
   * @param {string|null} timeframe - Si se especifica, solo descarga ese timeframe (ej: "15m")
   * @param {boolean} isBackground - Si true, no afecta loading/error globales
   */
  const loadBacktestingData = async (symbolToLoad, forceRefresh = false, timeframe = null, isBackground = false) => {
    if (!isBackground) {
      setLoading(true);
      setError(null);
    }

    try {
      const tfLabel = timeframe ? ` [solo ${timeframe}]` : ' [todos]';
      console.log(`[BacktestingApp] Cargando datos para ${symbolToLoad}${tfLabel}... (force_refresh: ${forceRefresh}, bg: ${isBackground})`);

      const params = new URLSearchParams();
      if (forceRefresh) params.append('force_refresh', 'true');
      if (timeframe) params.append('timeframe', timeframe);
      const queryString = params.toString();
      const url = `${API_BASE_URL}/api/backtesting/bulk-data/${symbolToLoad}${queryString ? '?' + queryString : ''}`;

      const response = await fetch(url);
      const data = withoutSubdivisions(await response.json());

      if (!data.success) {
        throw new Error(data.error || 'Error al cargar datos');
      }

      console.log(`[BacktestingApp] Datos cargados${tfLabel}:`, Object.keys(data.timeframes || {}));

      // Si descargamos solo 1 timeframe, mergear con los datos existentes
      // Usar marketDataRef.current para evitar stale closures en background downloads
      const currentData = marketDataRef.current;
      if (timeframe && currentData && currentData.timeframes) {
        const mergedData = {
          ...data,
          timeframes: {
            ...currentData.timeframes,
            ...data.timeframes
          }
        };
        setMarketData(mergedData);
        await saveToIndexedDB(symbolToLoad, mergedData);
        return mergedData;
      }

      setMarketData(data);
      await saveToIndexedDB(symbolToLoad, data);
      return data;

    } catch (err) {
      console.error('[BacktestingApp] Error:', err);
      if (!isBackground) {
        setError(err.message);
      }
      return null;
    } finally {
      if (!isBackground) {
        setLoading(false);
      }
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

        // Los datos ya están en memoria: si el caché falla, la app sigue sin él
        const skipCache = (reason) => {
          console.warn(`[IndexedDB] No se pudo guardar ${symbol}:`, reason);
          resolve();
        };

        try {
          const transaction = db.transaction(['marketData'], 'readwrite');
          const store = transaction.objectStore('marketData');

          const saveRequest = store.put({
            symbol: symbol,
            data: withoutSubdivisions(data), // Cada vela se guarda una sola vez
            savedAt: Date.now()
          });

          saveRequest.onsuccess = () => {
            console.log(`[IndexedDB] Datos guardados para ${symbol}`);
            resolve();
          };

          saveRequest.onerror = () => skipCache(saveRequest.error);
          transaction.onabort = () => skipCache(transaction.error);
        } catch (error) {
          skipCache(error);
        }
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
            // Retornar tanto los datos como el timestamp de cuándo se guardaron.
            // Un caché guardado antes trae la copia "subdivisions": se descarta y sigue sirviendo
            resolve({
              data: withoutSubdivisions(getRequest.result.data),
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

      // Usar caché si tiene datos del timeframe activo CON suficientes velas
      const cachedTfData = cachedResult.data.timeframes?.[activeTimeframe];
      if (cachedTfData && cachedTfData.main && cachedTfData.main.length > 0) {
        const lastCandle = cachedTfData.main[cachedTfData.main.length - 1];
        const firstCandle = cachedTfData.main[0];
        console.log(`[BacktestingApp] 📊 Caché encontrado para ${activeTimeframe}:`);
        console.log(`  - Velas totales: ${cachedTfData.main.length.toLocaleString()}`);
        console.log(`  - Primera vela: ${new Date(firstCandle.timestamp).toISOString()}`);
        console.log(`  - Última vela: ${new Date(lastCandle.timestamp).toISOString()}`);
        console.log(`  - Edad del caché: ${cacheAgeHours.toFixed(2)} horas`);

        // 🎯 FIX CRÍTICO: Validación de caché con verificación de datos recientes
        const intervalMin = INTERVAL_MINUTES[activeTimeframe] || 15;
        const minDaysRequired = 30; // Mínimo razonable para backtesting
        const minCandlesRequired = Math.floor((minDaysRequired * 24 * 60) / intervalMin);
        const actualCandles = cachedTfData.main.length;
        const hasMinimumData = actualCandles >= minCandlesRequired;

        // 🔧 NUEVA VALIDACIÓN: Verificar que los datos lleguen hasta una fecha RECIENTE
        const now = Date.now();
        const lastCandleAge = now - lastCandle.timestamp;
        const lastCandleAgeDays = lastCandleAge / (1000 * 60 * 60 * 24);
        const maxAllowedAgeDays = 30; // Los datos no pueden ser más viejos de 30 días
        const hasRecentData = lastCandleAgeDays <= maxAllowedAgeDays;

        const expectedDaysConfig = DAYS_BY_TIMEFRAME[activeTimeframe] || 1825;
        const expectedCandlesConfig = Math.floor((expectedDaysConfig * 24 * 60) / intervalMin);
        const coveragePct = (actualCandles / expectedCandlesConfig * 100).toFixed(1);

        console.log(`  - Cobertura: ${coveragePct}% del máximo configurado (${expectedDaysConfig} días)`);
        console.log(`  - Mínimo requerido: ${minCandlesRequired} velas (${minDaysRequired} días)`);
        console.log(`  - Tiene datos suficientes: ${hasMinimumData ? '✅ SÍ' : '❌ NO'}`);
        console.log(`  - Última vela edad: ${lastCandleAgeDays.toFixed(1)} días`);
        console.log(`  - Datos recientes (< ${maxAllowedAgeDays} días): ${hasRecentData ? '✅ SÍ' : '❌ NO'}`);

        if (!hasMinimumData) {
          console.log(`[BacktestingApp] ❌ Cache con muy pocas velas (${actualCandles} < ${minCandlesRequired})`);
          console.log(`[BacktestingApp] Forzando descarga completa del servidor...`);
          // No usar el cache - forzar descarga del servidor
        } else if (!hasRecentData) {
          console.log(`[BacktestingApp] ❌ Cache con datos MUY ANTIGUOS (última vela: ${lastCandleAgeDays.toFixed(1)} días atrás)`);
          console.log(`[BacktestingApp] Forzando descarga completa del servidor...`);
          // No usar el cache - forzar descarga del servidor
        } else {
          console.log(`[BacktestingApp] ✅ Cache válido - REUTILIZANDO datos existentes`);

          // 🎯 FIX: Solo verificar actualizaciones si el caché tiene más de 1 hora
          // Para backtesting, los datos históricos no cambian, solo agregar velas nuevas
          if (cacheAgeHours > 1.0) {
            console.log(`[BacktestingApp] 🔄 Cache antiguo (${cacheAgeHours.toFixed(1)}h), verificando si hay velas nuevas...`);

            try {
              // Verificar si el backend tiene velas más recientes
              const backendResponse = await fetch(`${API_BASE_URL}/api/backtesting/bulk-data/${symbol}?timeframe=${activeTimeframe}`);
              const backendData = withoutSubdivisions(await backendResponse.json());

              if (backendData.success && backendData.timeframes?.[activeTimeframe]) {
                const backendCandles = backendData.timeframes[activeTimeframe].main;
                const backendLastCandle = backendCandles[backendCandles.length - 1];

                if (backendLastCandle.timestamp > lastCandle.timestamp) {
                  console.log(`[BacktestingApp] 🆕 Hay ${backendCandles.length - actualCandles} velas nuevas en el servidor`);
                  console.log(`[BacktestingApp] Actualizando caché con datos completos...`);

                  // Usar los datos actualizados del backend
                  shouldUseCachedData = true;
                  data = backendData;
                  setMarketData(data);
                  await saveToIndexedDB(symbol, data);
                  console.log('[BacktestingApp] ✅ Caché actualizado con velas nuevas');
                } else {
                  console.log(`[BacktestingApp] ✅ No hay velas nuevas - usando caché existente`);
                  shouldUseCachedData = true;
                  data = cachedResult.data;
                  setMarketData(data);
                }
              } else {
                // Fallback: usar caché existente si falla la verificación
                console.warn('[BacktestingApp] ⚠️ No se pudo verificar actualizaciones, usando caché existente');
                shouldUseCachedData = true;
                data = cachedResult.data;
                setMarketData(data);
              }
            } catch (err) {
              console.warn('[BacktestingApp] ⚠️ Error al verificar actualizaciones:', err.message);
              // En caso de error, usar el caché existente (modo offline)
              console.log('[BacktestingApp] 📴 Modo offline - usando caché existente');
              shouldUseCachedData = true;
              data = cachedResult.data;
              setMarketData(data);
            }
          } else {
            // Caché reciente (< 1 hora) - usar directamente sin verificar actualizaciones
            console.log(`[BacktestingApp] ⚡ Cache reciente (${cacheAgeHours.toFixed(1)}h) - usando directamente sin verificar actualizaciones`);
            shouldUseCachedData = true;
            data = cachedResult.data;
            setMarketData(data);
          }
        }
      }
    }

    // Si no hay caché válido, descargar del servidor
    if (!shouldUseCachedData) {
      console.log(`[BacktestingApp] ❌ No hay caché válido para ${activeTimeframe}`);
      console.log(`[BacktestingApp] 📥 Descargando histórico completo del servidor (primera carga, tardará varios minutos)...`);
      // 🔧 FIX: NO pasar activeTimeframe - descargar TODOS los timeframes en la carga inicial
      // Esto asegura que todos los timeframes (1m, 5m, 15m, 1h, 4h) se descarguen de una vez
      data = await loadBacktestingData(symbol, false, null);
    }

    if (data && data.timeframes && data.timeframes[activeTimeframe]) {
      const timeframeData = data.timeframes[activeTimeframe];
      const firstCandle = timeframeData.main[0];
      const lastCandle = timeframeData.main[timeframeData.main.length - 1];

      // Determinar el simulationStartTime
      // Si el usuario especificó una fecha de inicio, usar esa como simulationStartTime
      // De lo contrario, usar el primer dato del historial
      let simulationStartTime;

      let blindStart = null;
      if (blindRequested) {
        const blind = await fetchBlindStart(symbol, firstCandle.timestamp, lastCandle.timestamp)
          .catch(failure => ({ reason: `No se pudo elegir la fecha oculta: ${failure.message}` }));
        if (!blind.timestamp) {
          setError(`❌ ${blind.reason}`);
          return;
        }
        blindStart = blind.timestamp;
      }

      console.log('[BacktestingApp] DEBUG - startDate:', startDate);
      console.log('[BacktestingApp] DEBUG - firstCandle.timestamp:', firstCandle.timestamp, new Date(firstCandle.timestamp).toISOString());
      console.log('[BacktestingApp] DEBUG - lastCandle.timestamp:', lastCandle.timestamp, new Date(lastCandle.timestamp).toISOString());

      if (blindStart !== null || (startDate && startDate.trim() !== '')) {
        // Crear fecha en hora local del navegador (medianoche)
        const startTimestamp = blindStart ?? new Date(startDate + 'T00:00:00').getTime();

        console.log('[BacktestingApp] DEBUG - startDate input:', startDate);
        console.log('[BacktestingApp] DEBUG - startTimestamp calculado:', startTimestamp, new Date(startTimestamp).toISOString());

        // VALIDACIÓN 1: Verificar que la fecha esté dentro del rango de datos disponibles
        // Buffer dinámico: 3 días para timeframes cortos (1m/5m/15m), 7 días para el resto
        const bufferDays = ['1m', '5m', '15m'].includes(activeTimeframe) ? 3 : 7;
        const minDataBuffer = bufferDays * 24 * 60 * 60 * 1000;
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
        // Sin fecha de inicio - usar un default razonable según timeframe
        // Timeframes cortos: más cercano al presente, largos: más atrás
        const defaultDaysBack = {
          '1m': 30,     // 1 mes atrás (1m tiene mucha densidad)
          '5m': 90,     // 3 meses atrás
          '15m': 180,   // 6 meses atrás
          '1h': 365,    // 1 año atrás
          '4h': 730     // 2 años atrás
        };
        const daysBack = defaultDaysBack[activeTimeframe] || 365;
        const defaultAgo = lastCandle.timestamp - (daysBack * 24 * 60 * 60 * 1000);
        const defaultStartIndex = timeframeData.main.findIndex(c => c.timestamp >= defaultAgo);

        if (defaultStartIndex !== -1) {
          simulationStartTime = timeframeData.main[defaultStartIndex].timestamp;
          setSimulationStartTime(simulationStartTime); // 🎯 NUEVO: Guardar para usar en applyConfig
          console.log(`[BacktestingApp] Sin fecha de inicio especificada, usando hace ~${daysBack} días:`, new Date(simulationStartTime).toISOString());
        } else {
          // Fallback: usar el primer dato del historial
          simulationStartTime = firstCandle.timestamp;
          setSimulationStartTime(simulationStartTime); // 🎯 NUEVO: Guardar para usar en applyConfig
          console.log('[BacktestingApp] Sin fecha de inicio especificada, usando primer dato:', new Date(simulationStartTime).toISOString());
        }
      }

      setBlindAnchor(blindStart !== null ? simulationStartTime : null);
      // Precio como índice y volumen relativo: el nivel del precio también ubicaría la época
      setBlindScale(blindStart !== null ? scaleFromCandles(timeframeData.main, simulationStartTime) : null);
      setBlindActive(blindStart !== null);
      maxSimTimeRef.current = 0;

      // Al volver de Configurar el reloj anterior puede seguir andando
      timeControllerRef.current?.destroy();
      captureHold.cancel();
      settledTimeRef.current = null;
      setIsPlaying(false);

      // Crear TimeController
      // IMPORTANTE:
      // - startTime = firstCandle.timestamp (para mostrar TODO el historial)
      // - simulationStartTime = fecha donde empieza la simulación
      // - endTime = lastCandle.timestamp
      // - currentTime se inicializará en simulationStartTime
      const controller = new TimeController(
        firstCandle.timestamp,     // startTime: inicio del historial (para mostrar todo)
        lastCandle.timestamp,       // endTime: fin del historial
        activeTimeframe,            // timeframe de referencia (para subdivisiones)
        handleTimeUpdate,           // callback
        simulationStartTime         // simulationStartTime: donde empieza la simulación
      );
      controller.setSpeed(playbackSpeed); // El selector conserva su valor al volver de Configurar

      // Inicializar sincronización multi-pestaña
      const sessionId = `${symbol}_multi_${Date.now()}`;
      controller.initSync(sessionId);

      timeControllerRef.current = controller;

      // Crear OrderManager
      if (!orderManagerRef.current) {
        orderManagerRef.current = new OrderManager(10000); // Balance inicial $10,000

        // 🎯 NUEVO: Conectar callback para cuando una orden pendiente se ejecuta
        orderManagerRef.current.onOrderExecuted = (executedOrder) => {
          eventHandlersRef.current.orderExecuted?.(executedOrder);
        };

        console.log('[BacktestingApp] OrderManager creado');

        // 🎯 FIX CRÍTICO: Adjuntar event listeners UNA VEZ (aquí OrderManager existe)
        // Los listeners llaman a través de eventHandlersRef que es actualizado por useEffect
        if (!orderManagerRef.current._listenersAttached) {
          console.log('[BacktestingApp] 🔗 Adjuntando event listeners permanentes del OrderManager...');

          orderManagerRef.current.on('tradeClosed', (event) => {
            if (eventHandlersRef.current.tradeClosed) {
              eventHandlersRef.current.tradeClosed(event);
            }
          });

          orderManagerRef.current.on('tradeOpened', (event) => {
            if (eventHandlersRef.current.tradeOpened) {
              eventHandlersRef.current.tradeOpened(event);
            }
          });

          orderManagerRef.current.on('orderCancelled', ({ order }) => {
            recordCancel(order, timeControllerRef.current?.currentTime ?? null)
              .then(() => setObserverRevision(value => value + 1));
            saveTradeSession();
          });

          // Marcar que ya se adjuntaron para no duplicar en re-inicializaciones
          orderManagerRef.current._listenersAttached = true;
          console.log('[BacktestingApp] ✅ Event listeners permanentes adjuntados');
        } else {
          console.log('[BacktestingApp] ⏭️ Event listeners ya estaban adjuntados');
        }
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

      // Descargar los demás timeframes en background (si solo descargamos uno)
      if (!shouldUseCachedData) {
        const otherTimeframes = AVAILABLE_TIMEFRAMES.filter(tf => tf !== activeTimeframe && !data.timeframes[tf]);
        if (otherTimeframes.length > 0) {
          console.log(`[BacktestingApp] Descargando ${otherTimeframes.length} timeframes restantes en background...`);
          // Marcar timeframes como "descargando"
          setDownloadingTimeframes(new Set(otherTimeframes));
          // Descargar secuencialmente para no sobrecargar el backend
          (async () => {
            for (const tf of otherTimeframes) {
              try {
                console.log(`[BacktestingApp] [BG] Descargando ${tf}...`);
                const bgData = await loadBacktestingData(symbol, false, tf, true);
                // Precalcular indicadores del timeframe recién descargado
                if (bgData && bgData.timeframes && bgData.timeframes[tf]) {
                  const miniChart = miniChartRefs.current[tf];
                  if (miniChart && miniChart.precalculateIndicators) {
                    console.log(`[BacktestingApp] [BG] Precalculando indicadores para ${tf}...`);
                    await miniChart.precalculateIndicators(bgData.timeframes[tf].main, simulationStartTime);
                  }
                }
                console.log(`[BacktestingApp] [BG] ${tf} completado`);
              } catch (err) {
                console.warn(`[BacktestingApp] [BG] Error descargando ${tf}:`, err);
              } finally {
                // Remover timeframe del set de "descargando"
                setDownloadingTimeframes(prev => {
                  const next = new Set(prev);
                  next.delete(tf);
                  return next;
                });
              }
            }
            console.log('[BacktestingApp] [BG] Todos los timeframes descargados');
          })();
        }
      }
    }
  };

  /**
   * Liquida órdenes con las velas que cerraron desde la última revisión, en orden.
   * Cambiar de pestaña no mueve el tiempo, así que no puede llenar ni cerrar órdenes.
   */
  const settleOrders = (timeframes, now) => {
    const manager = orderManagerRef.current;
    if (!manager || !timeframes || !now) return;
    const idle = manager.openOrders.length === 0 && manager.pendingOrders.length === 0;
    if (settledTimeRef.current === null || now < settledTimeRef.current || idle) {
      settledTimeRef.current = now;
      return;
    }
    const { tf, candles, settledTo } = candlesToSettle(timeframes, settledTimeRef.current, now);
    candles.forEach(candle => manager.updateOrders(candle, candle.timestamp + TF_MS[tf]));
    settledTimeRef.current = settledTo;
  };

  /**
   * Callback cuando el tiempo cambia
   */
  const handleTimeUpdate = (newTime) => {
    // 🎯 FIX: Usar refs para acceder a valores actuales (no del closure)
    const timeframes = marketDataRef.current?.timeframes;
    const currentActiveTimeframe = activeTimeframeRef.current;
    const hasData = !!timeframes?.[currentActiveTimeframe];

    // Revisa TP, SL y órdenes pendientes con las velas ya cerradas, en cada tick
    if (hasData) settleOrders(timeframes, newTime);

    // La pantalla no necesita cada tick: el gráfico se dibuja 10 veces por segundo como mucho
    const now = performance.now();
    if (timeControllerRef.current?.isPlaying && now - lastScreenUpdateRef.current < SCREEN_UPDATE_MS) return;
    lastScreenUpdateRef.current = now;

    setCurrentTime(newTime);
    if (!hasData) return;

    // Último precio que ya ocurrió en la hora simulada
    const knownPrice = priceAt(timeframes, newTime);
    if (knownPrice === null) return;
    setCurrentPrice(knownPrice);

    // Double Top/Bottom y Swing siguen la hora simulada
    const indicatorManager = miniChartRefs.current[currentActiveTimeframe]?.getIndicatorManager?.();
    indicatorManager?.updateDTBPlaybackDate?.(newTime);
    indicatorManager?.updateSwingPlaybackTime?.(newTime);
    indicatorManager?.updateSRPlaybackTime?.(newTime);
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
    captureHold.cancel();
    if (timeControllerRef.current) {
      timeControllerRef.current.pause();
      setIsPlaying(false);
      handleTimeUpdate(timeControllerRef.current.currentTime); // La pantalla queda en la hora exacta
    }
  };

  const handleStop = () => {
    console.log('[BacktestingApp] handleStop clicked');
    captureHold.cancel();
    if (timeControllerRef.current) {
      timeControllerRef.current.stop();
      setIsPlaying(false);
      handleTimeUpdate(timeControllerRef.current.currentTime); // La pantalla queda en la hora exacta
      // Stop ya no resetea el tiempo, solo pausa
      // El currentTime se mantiene en la posición actual
    }
  };

  const handleSpeedChange = (speed) => {
    if (timeControllerRef.current) {
      timeControllerRef.current.setSpeed(speed);
      setPlaybackSpeed(speed);
      // A velocidad baja el siguiente tick tarda: la pantalla no se queda atrás del reloj
      lastScreenUpdateRef.current = 0;
      handleTimeUpdate(timeControllerRef.current.currentTime);
    }
  };

  /**
   * 🎯 NUEVO: Actualizar currentPrice cuando currentTime cambia
   * Esto asegura que TradingControls siempre tenga el precio correcto
   */
  useEffect(() => {
    if (!marketData || !currentTime) return;

    maxSimTimeRef.current = Math.max(maxSimTimeRef.current, currentTime);

    if (tickAlreadySettled(timeControllerRef.current, currentTime)) return;

    const timeframeData = marketData.timeframes?.[activeTimeframe];
    if (!timeframeData || !timeframeData.main) return;

    // Último precio que ya ocurrió en la hora simulada
    const knownPrice = priceAt(marketData.timeframes, currentTime);

    if (knownPrice !== null) {
      setCurrentPrice(knownPrice);
      settleOrders(marketData.timeframes, currentTime);
    }
  }, [currentTime, marketData, activeTimeframe]);

  // Estables para que el panel del Observador no se redibuje con cada cambio de hora
  const observerViewer = useCallback(() => ({
    // Lo vivido llega hasta el reloj: la pantalla puede ir atrás de una orden que ya cerró
    reached: Math.max(maxSimTimeRef.current, timeControllerRef.current?.currentTime ?? 0),
    blindActive: isBlind(),
    sessionId: sessionIdRef.current
  }), []);

  // "Ir al gráfico" desde una imagen o una lectura: mueve la vista y nunca la hora simulada
  const pendingFocusRef = useRef(null);
  const focusPending = () => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const chart = miniChartRefs.current[pending.tf];
    if (chart?.focusOn?.(pending.time, pending.price)) {
      pendingFocusRef.current = null;
    } else if (pending.tries++ < 10) {
      setTimeout(focusPending, 100); // El marco recién mostrado todavía no se dibuja
    } else {
      pendingFocusRef.current = null;
    }
  };

  const goToItem = useCallback((item) => {
    const time = item.time ?? item.selectedAt;
    if (!Number.isFinite(time)) return 'No tiene un momento al cual ir.';
    const now = timeControllerRef.current?.currentTime;
    if (Number.isFinite(now) && time > now) return 'Ese momento está después de la hora simulada.';

    const tf = ['1m', '5m', '15m', '1h', '4h'].includes(item.timeframe) ? item.timeframe : activeTimeframeRef.current;
    pendingFocusRef.current = { time, price: Number.isFinite(item.price) ? item.price : null, tf, tries: 0 };
    if (tf !== activeTimeframeRef.current) latestRef.current.handleTabChange?.(tf);
    else focusPending();
    return null;
  }, []);

  useEffect(() => {
    focusPending();
  }, [activeTimeframe]);

  const revealDate = useCallback(() => {
    setBlindAnchor(null);
    setBlindScale(null);
    setBlindActive(false);
    latestRef.current.applyToAllTimeframes(() => {});
  }, []);

  /** Registra una orden nueva junto con lo que había en pantalla */
  const observeOrder = (order) => {
    // La pantalla puede ir un poco detrás del reloj: la orden se revisa desde su propia hora
    settledTimeRef.current = Math.min(settledTimeRef.current ?? order.entryTime, order.entryTime);

    const miniChart = miniChartRefs.current[activeTimeframe];
    const manager = miniChart?.getIndicatorManager?.();
    const indicators = tabStates[activeTimeframe]?.indicatorStates || {};
    // Niveles y marcas elegidos hasta ese momento: valen solo para esta orden. Van con ella, se ubican en
    // cada imagen suya y salen de la lista, que queda vacía para el trade siguiente
    order.analysisItems = takeLevels(symbol, order.entryTime);

    recordOrder(order, {
      symbol,
      timeframe: activeTimeframe,
      session: ensureSessionId(),
      price: currentPrice,
      rewound: order.entryTime < maxSimTimeRef.current,
      indicators: Object.keys(indicators).filter(name => indicators[name]),
      ranges: rangesInUse(manager?.getFixedRangeProfiles?.() || [], order.entryTime),
      drawings: drawingsForOrder(miniChart?.getDrawings?.(), order.entryTime, TF_MS[activeTimeframe]),
      levels: order.analysisItems
    }).then(() => setObserverRevision(value => value + 1));
  };

  // Imagen de cierre: la simulación ya pasó las velas que siguen al trade
  useEffect(() => {
    const due = exitCapturesDue(orderManagerRef.current?.closedOrders, currentTime);
    due.forEach(order => captureExit(order, miniChartRefs.current[activeTimeframe]));
  }, [currentTime]);

  useEffect(() => {
    if (activePanel === 'observer' || observerPopup) setObserverUnread(0);
  }, [activePanel, observerUnread, observerPopup]);

  // Segundo gráfico en otra pestaña: sigue la hora simulada de esta
  const replayStateRef = useRef(null);
  const replayChannelRef = useRef(null);
  useEffect(() => {
    const channel = openReplayChannel();
    replayChannelRef.current = channel;
    if (channel) {
      channel.onmessage = (event) => {
        if (event.data?.type === 'hello' && replayStateRef.current) channel.postMessage(replayStateRef.current);
      };
    }
    return () => channel?.close();
  }, []);

  useEffect(() => {
    if (!initialized || !symbol) return;
    const state = {
      type: 'state', symbol, currentTime, simulationStartTime, activeTimeframe,
      blindAnchor: blindAnchor(), blindScale: blindScale(),
      trades: tradeBoundaries(orderManagerRef.current?.orders)
    };
    replayStateRef.current = state;
    replayChannelRef.current?.postMessage(state);
  }, [initialized, symbol, currentTime, simulationStartTime, blindActive, activeTimeframe]);

  const openSecondaryChart = useCallback(() => {
    const tab = window.open(secondaryChartUrl(), 'app1-grafico2');
    if (!tab) window.alert('El navegador bloqueó la pestaña. Permite las ventanas emergentes para esta página y vuelve a intentarlo.');
  }, []);

  const popOutObserver = useCallback(() => {
    const popup = openPopup('app1-observador', { width: 1000, height: 920 });
    if (popup) setObserverPopup(popup);
  }, []);

  const bringObserverBack = useCallback(() => {
    setObserverPopup(current => {
      if (current && !current.closed) current.close();
      return null;
    });
  }, []);

  useEffect(() => {
    if (!observerNotice) return undefined;
    const timer = setTimeout(() => setObserverNotice(null), OBSERVER_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [observerNotice]);

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

  // El modal del perfil edita el perfil de los gráficos: antes cambiaba un estado que ningún gráfico leía.
  // Todo va al marco activo; los colores y el degradado, a todos los marcos, como el Order Flow
  const handleVpConfigChange = (newConfig) => {
    setVpConfig(newConfig);
    const visual = Object.fromEntries(
      [...Object.keys(VP_FACTORY), 'customVisual'].filter(key => newConfig[key] !== undefined).map(key => [key, newConfig[key]])
    );
    setTabStates(prev => Object.fromEntries(Object.entries(prev).map(([tf, state]) => [tf, {
      ...state,
      vpConfig: tf === activeTimeframe ? { ...(state?.vpConfig || {}), ...newConfig } : { ...(state?.vpConfig || {}), ...visual }
    }])));
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

  /** Velas del marco activo ya cerradas en la hora simulada */
  const closedCandles = () => {
    const main = marketData?.timeframes?.[activeTimeframe]?.main || [];
    return main.slice(0, lastClosedIndex(main, activeTimeframe, currentTime) + 1);
  };

  /** Aplica un cambio de parámetros en los gráficos de todos los marcos y los redibuja */
  const applyToAllTimeframes = (change) => {
    AVAILABLE_TIMEFRAMES.forEach(tf => {
      const miniChart = miniChartRefs.current[tf];
      const manager = miniChart?.getIndicatorManager?.();
      if (!manager) return;
      change(manager);
      miniChart.forceRedraw?.();
    });
  };
  latestRef.current.applyToAllTimeframes = applyToAllTimeframes;

  const handleOpenOIVolumeConfluenceSettings = (indicatorManager) => {
    indicatorManagerRef.current = indicatorManager;
    setShowOIVolumeConfluenceSettings(true);
  };

  const handleRejectionPatternConfigChange = (config) => {
    if (config === rejectionConfigRef.current) return;
    rejectionConfigRef.current = config;
    setRejectionPatternConfig(config);
    applyToAllTimeframes(manager => manager.updateRejectionPatternConfig(config));
  };

  /**
   * 📍 Navegar al trade en el gráfico
   * Lleva la vista a la entrada del trade sin mover la hora simulada: el trade ya ocurrió y lo que
   * vino después ya se vio. Dibuja la caja Entry/SL/TP si no la tiene
   */
  // Estable para que el Historial no se rearme con cada cambio de hora
  const handleNavigateToTrade = useCallback((order, tradeNumber) => {
    console.log(`[BacktestingApp] 📍 Navegando al trade #${tradeNumber || '?'}:`, order);

    const miniChart = miniChartRefs.current[activeTimeframe];
    if (!miniChart || !miniChart.focusOn) {
      console.warn('[BacktestingApp] ⚠️ MiniChart o focusOn no disponible');
      return;
    }

    // 🔧 FIX: Centrar en la línea vertical del trade (no en el punto medio).
    // Una orden limit se ejecuta después de crearse: la línea está en la ejecución
    const targetTimestamp = order.executedAt ?? order.entryTime;

    // Tras retroceder el tiempo, un trade posterior a la hora simulada no se puede mostrar sin adelantarla
    const now = timeControllerRef.current?.currentTime;
    if (Number.isFinite(now) && targetTimestamp > now) {
      console.warn(`[BacktestingApp] El trade #${tradeNumber || '?'} está después de la hora simulada`);
      return;
    }

    console.log(`[BacktestingApp] 📍 Centrando en timestamp de entrada del trade: ${new Date(targetTimestamp).toISOString()}`);
    console.log(`[BacktestingApp]   - Exit: ${new Date(order.exitTime).toISOString()}`);

    // Dibujar la caja del trade si tiene SL/TP y todavía no la tiene
    if (!order.tpslBoxId && miniChart.addTPSLBox && (order.stopLoss || order.takeProfit)) {
      // Calcular ancho de la caja basado en duración del trade
      const tradeDurationMs = order.exitTime - targetTimestamp;
      const intervalMs = {
        '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000
      }[activeTimeframe] || 900000;

      // Ancho = duración del trade en velas (mínimo 5, máximo 50)
      const candleWidthCount = Math.max(5, Math.min(50, Math.ceil(tradeDurationMs / intervalMs)));

      console.log(`[BacktestingApp] 📍 Dibujando caja del trade (${candleWidthCount} velas de ancho)`);

      order.tpslBoxId = miniChart.addTPSLBox(
        order.entryPrice,
        targetTimestamp,
        order.side, // 'long' o 'short'
        order.stopLoss,
        order.takeProfit,
        candleWidthCount
      );
    }

    // Llevar la vista a la entrada, con lo que pasó después a la derecha
    miniChart.focusOn(targetTimestamp, null, { mark: false });

    // 🎯 REMOVED: setSelectedTradeInfo() ya no existe - las líneas permanentes se dibujan
    // automáticamente via eventos tradeOpened/tradeClosed suscritos en líneas 908-918
  }, [activeTimeframe]);

  /**
   * 🎯 Order Flow: Anclar/desanclar footprint
   */
  const handleToggleFootprintPin = (timestamp) => {
    setPinnedFootprints(prev => {
      if (prev.includes(timestamp)) {
        // Desanclar
        console.log(`[BacktestingApp] 📌 Desanclando footprint: ${new Date(timestamp).toISOString()}`);
        return prev.filter(ts => ts !== timestamp);
      } else {
        // Anclar (máximo 10)
        if (prev.length >= 10) {
          console.warn('[BacktestingApp] ⚠️ Máximo 10 footprints anclados alcanzado');
          return prev; // No agregar más
        }
        console.log(`[BacktestingApp] 📌 Anclando footprint: ${new Date(timestamp).toISOString()}`);
        return [...prev, timestamp];
      }
    });
  };

  /**
   * 🎯 Order Flow: Navegar a un footprint en el gráfico
   */
  const handleNavigateToFootprint = (timestamp) => {
    console.log(`[BacktestingApp] 📍 Navegando a footprint: ${new Date(timestamp).toISOString()}`);

    const miniChart = miniChartRefs.current[activeTimeframe];
    if (!miniChart || !miniChart.centerOnTimestamp) {
      console.warn('[BacktestingApp] ⚠️ MiniChart o centerOnTimestamp no disponible');
      return;
    }

    // Centrar el gráfico en el timestamp del footprint
    miniChart.centerOnTimestamp(timestamp);
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
  latestRef.current.handleTabChange = handleTabChange;

  /**
   * 🔧 FIX: Handler para sincronizar dibujos en tiempo real entre tabs
   */
  const handleDrawingsChange = (shapes, sourceInterval) => {
    console.log(`[BacktestingApp] Sincronizando ${shapes.length} dibujos desde ${sourceInterval} a otros tabs`);
    // La caja de una orden viva no se separa de la orden: si se movió, vuelve a sus precios, también en el origen
    const kept = boxesFollowOrders(shapes, orderManagerRef.current?.orders);
    setChartShapes(kept || shapes);

    // Cargar los mismos dibujos en todos los tabs (el origen solo si una caja volvió a su orden)
    // skipSync = true para evitar loop infinito
    AVAILABLE_TIMEFRAMES.forEach(tf => {
      if (tf !== sourceInterval || kept) {
        const miniChart = miniChartRefs.current[tf];
        if (miniChart && miniChart.loadDrawings) {
          miniChart.loadDrawings(kept || shapes, true); // true = skipSync
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
    setShowOIVolumeConfluenceSettings(false);
    setShowOrderFlowSettings(false);
    setShowFVGSettings(false);
    setShowVPPeriodicSettings(false);
    setShowResponseVolumeSettings(false);
    setShowLiquidationsSettings(false);
    setShowOFElementsSettings(false);
    setShowOFSetupsSettings(false);
  }, [activeTimeframe]);

  // 🔧 FIX: Forzar redibujado del canvas cuando se entra/sale de fullscreen
  // para asegurar que los indicadores se renderizan con las alturas correctas
  useEffect(() => {
    // Primer redibujado: Inmediato después de que el layout se ajuste
    const timer1 = setTimeout(() => {
      Object.values(miniChartRefs.current).forEach(chart => {
        if (chart && chart.forceRedraw) {
          chart.forceRedraw();
        }
      });
      if (fullscreenPanel === 'chart') {
        console.log('[BacktestingApp] 🔧 Canvas redibujado (1/3) al entrar a fullscreen');
      } else if (fullscreenPanel === null) {
        console.log('[BacktestingApp] 🔧 Canvas redibujado (1/3) al salir de fullscreen');
      }
    }, 150);

    // Segundo redibujado: Backup para asegurar dimensiones correctas
    const timer2 = setTimeout(() => {
      Object.values(miniChartRefs.current).forEach(chart => {
        if (chart && chart.forceRedraw) {
          chart.forceRedraw();
        }
      });
      if (fullscreenPanel === 'chart') {
        console.log('[BacktestingApp] 🔧 Canvas redibujado (2/3) al entrar a fullscreen');
      } else if (fullscreenPanel === null) {
        console.log('[BacktestingApp] 🔧 Canvas redibujado (2/3) al salir de fullscreen');
      }
    }, 400);

    // Tercer redibujado: Delay extra al salir de fullscreen (el DOM tarda en reflow)
    const timer3 = setTimeout(() => {
      Object.values(miniChartRefs.current).forEach(chart => {
        if (chart && chart.forceRedraw) {
          chart.forceRedraw();
        }
      });
      if (fullscreenPanel === 'chart') {
        console.log('[BacktestingApp] 🔧 Canvas redibujado (3/3) al entrar a fullscreen');
      } else if (fullscreenPanel === null) {
        console.log('[BacktestingApp] 🔧 Canvas redibujado (3/3) al salir de fullscreen - FINAL');
      }
    }, 800);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [fullscreenPanel]);

  // 🔧 FIX: Forzar redibujado cuando el sidebar de dibujo cambia de estado
  // El ancho del chart cambia cuando el sidebar aparece/desaparece/colapsa
  useEffect(() => {
    // Esperar a que el DOM termine de reflow
    const timer = setTimeout(() => {
      Object.values(miniChartRefs.current).forEach(chart => {
        if (chart && chart.forceRedraw) {
          chart.forceRedraw();
        }
      });
      const sidebarState = drawingSidebarHidden ? 'oculto' : (drawingSidebarCollapsed ? 'colapsado' : 'expandido');
      console.log(`[BacktestingApp] 🔧 Canvas redibujado por cambio de sidebar: ${sidebarState}`);
    }, 300);

    return () => clearTimeout(timer);
  }, [drawingSidebarCollapsed, drawingSidebarHidden]);

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

      // Observador
      blindAnchor: blindAnchor(),
      blindScale: blindScale(),
      maxSimTime: maxSimTimeRef.current,

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
  latestRef.current.captureCurrentState = captureCurrentState;

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

      setBlindAnchor(session.blindAnchor);
      // Una sesión oculta guardada antes del índice no trae escala: se arma con sus velas
      setBlindScale(session.blindAnchor == null ? null
        : session.blindScale || scaleFromCandles(marketDataRef.current?.timeframes?.[session.activeTimeframe || activeTimeframe]?.main, session.blindAnchor));
      setBlindActive(isBlind());
      maxSimTimeRef.current = session.maxSimTime ?? 0;

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
        // Las líneas verticales salen de las órdenes
        AVAILABLE_TIMEFRAMES.forEach(tf => miniChartRefs.current[tf]?.redraw?.());
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
                indicatorStates: { ...getDefaultIndicatorStates(tf), ...tabData.indicatorStates },
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
      sessionIdRef.current = session.sessionId;
      setCurrentSessionId(session.sessionId);
      setCurrentSessionName(session.sessionName);

      setObserverRevision(value => value + 1);
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
    sessionIdRef.current = sessionData.sessionId;
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
                disabled={loading || blindRequested}
              />
              <small style={{ color: '#666', fontSize: '12px', marginTop: '5px', display: 'block' }}>
                📅 Sin fecha = inicia hace ~1 año. Los datos históricos cubren ~3 años de información.
              </small>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={blindRequested}
                  onChange={(e) => setBlindRequested(e.target.checked)}
                  disabled={loading}
                  style={{ width: 'auto' }}
                />
                Fecha al azar y oculta
              </label>
              <small style={{ color: '#666', fontSize: '12px', marginTop: '5px', display: 'block' }}>
                Elige un día con trades descargados y muestra días relativos, para que no recuerdes qué pasó después.
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
      {/* 🎯 OPTIMIZACIÓN UI: Sidebar vertical de herramientas de dibujo (reemplaza toolbar horizontal) */}
      <DrawingSidebar
        selectedTool={currentTool}
        onToolChange={setCurrentTool}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClearAll={handleClearAll}
        isCollapsed={drawingSidebarCollapsed}
        isHidden={drawingSidebarHidden}
        onToggleCollapse={() => {
          // Ciclar: expandido → colapsado → oculto → expandido
          if (drawingSidebarHidden) {
            setDrawingSidebarHidden(false);
            setDrawingSidebarCollapsed(false);
          } else if (drawingSidebarCollapsed) {
            setDrawingSidebarHidden(true);
          } else {
            setDrawingSidebarCollapsed(true);
          }
        }}
      />

      {/* 🎯 OPTIMIZACIÓN UI: Botón flotante para mostrar sidebar cuando está oculto O colapsado */}
      {(drawingSidebarHidden || drawingSidebarCollapsed) && (
        <button
          className="btn-show-drawing-sidebar"
          onClick={() => {
            setDrawingSidebarHidden(false);
            setDrawingSidebarCollapsed(false);
          }}
          title="Mostrar sidebar de dibujo expandido (D)"
        >
          {isNewTheme() ? <Icon name="pencil" size={16} /> : '🖌'}
        </button>
      )}

      {showThemeSettings && <ThemeSettings onClose={() => setShowThemeSettings(false)} />}

      {/* 🎯 OPTIMIZACIÓN UI: Header único consolidado (fusión main.jsx + backtesting) */}
      <div className="backtesting-header compact">
        {/* Sección izquierda: Título App + Símbolo + Tiempo */}
        <div className="header-left">
          <span className="app-title">📊</span>
          <h2 className="symbol-title">{symbol}</h2>
          {currentTime && (
            <span className="current-time-compact">
              {isBlind() ? maskDate(currentTime) : new Date(currentTime).toLocaleString('es-CO', {
                timeZone: 'America/Bogota',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
          )}
          {currentPrice && (
            <span className="current-price-compact">
              {blindActive && pricesHidden()
                ? priceText(currentPrice)
                : isNewTheme()
                  ? currentPrice.toFixed(currentPrice >= 1000 ? 1 : currentPrice >= 1 ? 2 : 4)
                  : `$${currentPrice.toFixed(2)}`}
            </span>
          )}
        </div>

        {/* Sección centro: Controles de playback (solo iconos) */}
        <div className="header-center">
          <button
            className={`btn-control-compact ${isPlaying ? 'active' : ''}`}
            onClick={isPlaying ? handlePause : handlePlay}
            title={isPlaying ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'}
          >
            {isNewTheme() ? <Icon name={isPlaying ? 'pause' : 'play'} size={15} /> : (isPlaying ? '⏸' : '▶')}
          </button>

          <button
            className="btn-control-compact"
            onClick={handleStop}
            title="Detener"
          >
            {isNewTheme() ? <Icon name="stop" size={15} /> : '⏹'}
          </button>

          <select
            className="speed-control-compact"
            value={playbackSpeed}
            onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
            title="Velocidad de reproducción"
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
            <option value="1000">1000x</option>
            <option value="2000">2000x</option>
            <option value="3000">3000x</option>
            <option value="4000">4000x</option>
            <option value="5000">5000x</option>
            <option value="7500">7500x</option>
            <option value="10000">10000x</option>
            <option value="20000">20000x</option>
            <option value="30000">30000x</option>
            <option value="40000">40000x</option>
            <option value="50000">50000x</option>
          </select>

          {/* 🎯 OPTIMIZACIÓN UI: Tabs de timeframes movidos al header (mejora_2.pdf) */}
          <TimeframeTabs
            activeTimeframe={activeTimeframe}
            onTabChange={handleTabChange}
            orderCounts={getOrderCountsByTimeframe()}
            downloadingTimeframes={downloadingTimeframes}
            compact={true}
          />
        </div>

        {/* Sección derecha: Menú de acciones */}
        <div className="header-right">
          {/* Botón Actualizar datos (si hay metadata) */}
          {marketData && marketData.metadata && (
            <button
              className="btn-action-compact update"
              onClick={async () => {
                const confirmed = window.confirm('¿Actualizar datos históricos desde Bybit? Esto puede tardar 30-60 segundos y eliminará todos los cachés.');
                if (confirmed) {
                  try {
                    setLoading(true);
                    setError(null);
                    console.log('[BacktestingApp] ====== INICIANDO ACTUALIZACIÓN COMPLETA ======');
                    const deleteResponse = await fetch(`${API_BASE_URL}/api/backtesting/cache/${symbol}`, { method: 'DELETE' });
                    await deleteFromIndexedDB(symbol);
                    localStorage.removeItem(`backtesting_${symbol}`);
                    const freshData = await loadBacktestingData(symbol, true);
                    console.log('[BacktestingApp] Recargando página en 2 segundos...');
                    setTimeout(() => window.location.reload(), 2000);
                  } catch (err) {
                    console.error('[BacktestingApp] ❌ Error al actualizar:', err);
                    setError('Error al actualizar datos: ' + err.message);
                    setLoading(false);
                  }
                }
              }}
              title={`Actualizar datos desde Bybit\nÚltima actualización: ${new Date(marketData.metadata.date_range.end).toLocaleDateString('es-CO')}`}
            >
              {isNewTheme() ? <Icon name="refresh" size={15} /> : '🔄'}
            </button>
          )}

          {/* Segundo gráfico en otra pestaña, con la misma reproducción */}
          {initialized && (
            <button
              className="btn-action-compact theme-settings-btn"
              onClick={openSecondaryChart}
              title="Abrir un segundo gráfico en otra pestaña: sigue esta reproducción, con su propio marco e indicadores"
            >
              {isNewTheme() ? <><Icon name="layers" size={15} /><span>2.º gráfico</span></> : '🗗'}
            </button>
          )}

          {/* Estilo y colores */}
          <button
            className="btn-action-compact theme-settings-btn"
            onClick={() => setShowThemeSettings(true)}
            title="Estilo y colores"
          >
            {isNewTheme() ? <><Icon name="palette" size={15} /><span>Estilo</span></> : '🎨'}
          </button>

          {/* Selector de indicadores */}
          <div className="indicator-selector-compact" ref={indicatorPanelRef}>
            <button
              className="btn-action-compact indicators"
              onClick={() => setShowIndicatorPanel(!showIndicatorPanel)}
              title="Indicadores"
              style={{
                background: Object.values(tabStates[activeTimeframe]?.indicatorStates || {}).filter(v => v).length > 0 ? '#4CAF50' : 'transparent',
                padding: '4px 8px'
              }}
            >
              {isNewTheme()
                ? <><Icon name="layers" size={15} /><span>Indicadores {Object.values(tabStates[activeTimeframe]?.indicatorStates || {}).filter(v => v).length}</span></>
                : `📊 (${Object.values(tabStates[activeTimeframe]?.indicatorStates || {}).filter(v => v).length})`}
            </button>

            {showIndicatorPanel && (
              <div
                className="indicator-list-panel"
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
                    'Swing Detector': () => setShowSwingDetectorSettings(true),
                    'OI-Volume Confluence': () => setShowOIVolumeConfluenceSettings(true),
                    'Order Flow': () => setShowOrderFlowSettings(true),
                    'FVG': () => setShowFVGSettings(true),
                    'VP Periodic': () => setShowVPPeriodicSettings(true),
                    'Volumen de Respuesta': () => setShowResponseVolumeSettings(true),
                    'Liquidaciones': () => setShowLiquidationsSettings(true),
                    'Elementos OF': () => setShowOFElementsSettings(true)
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

                      {/* Selector de modo OI inline */}
                      {name === 'Open Interest' && enabled && (
                        <select
                          value={tabStates[activeTimeframe]?.oiMode || 'histogram'}
                          onChange={(e) => {
                            e.stopPropagation();
                            setTabStates(prev => ({
                              ...prev,
                              [activeTimeframe]: {
                                ...prev[activeTimeframe],
                                oiMode: e.target.value
                              }
                            }));
                          }}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            marginLeft: '8px',
                            padding: '2px 4px',
                            fontSize: '11px',
                            border: '1px solid #ccc',
                            borderRadius: '3px',
                            cursor: 'pointer',
                            background: '#f5f5f5'
                          }}
                        >
                          <option value="histogram">Histogram</option>
                          <option value="cumulative">Cumulative</option>
                          <option value="flow">Flow</option>
                        </select>
                      )}

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
                          {isNewTheme() ? <Icon name="sliders" size={13} /> : '⚙️'}
                        </span>
                      )}
                    </label>
                  );
                })}
                <button
                  type="button"
                  onClick={() => AVAILABLE_TIMEFRAMES.forEach(tf => miniChartRefs.current[tf]?.resetPanels?.())}
                  style={{
                    width: '100%',
                    marginTop: '8px',
                    padding: '4px 8px',
                    fontSize: '11px',
                    color: '#333',
                    background: '#f5f5f5',
                    border: '1px solid #ccc',
                    borderRadius: '3px',
                    cursor: 'pointer'
                  }}
                >
                  Restablecer orden y altura de paneles
                </button>
              </div>
            )}
          </div>

          {/* Menú dropdown de acciones */}
          <div className="actions-menu-compact">
            <button
              className="btn-action-compact menu-trigger"
              onClick={() => setShowActionsMenu(prev => !prev)}
              title="Menú de acciones"
            >
              ☰
            </button>

            {showActionsMenu && (
              <div className="actions-dropdown">
                <button onClick={() => { setShowSaveModal(true); setShowActionsMenu(false); }}>
                  💾 Guardar sesión
                  {currentSessionId && <span className="active-badge">●</span>}
                </button>
                <button onClick={() => { setShowLoadModal(true); setShowActionsMenu(false); }}>
                  📂 Cargar sesión
                </button>
                <button onClick={() => { setInitialized(false); setShowActionsMenu(false); }}>
                  ⚙️ Configurar
                </button>
                <div className="dropdown-divider"></div>
                <button onClick={() => { setShowTradingPanel(prev => !prev); setShowActionsMenu(false); }}>
                  📊 {showTradingPanel ? 'Ocultar' : 'Mostrar'} Panel
                </button>
                <button onClick={() => { setFullscreenPanel(prev => prev === 'chart' ? null : 'chart'); setShowActionsMenu(false); }}>
                  ⛶ {fullscreenPanel === 'chart' ? 'Restaurar' : 'Maximizar'} Chart
                </button>
                <div className="dropdown-divider"></div>
                <button onClick={() => { toggleFullscreen(); setShowActionsMenu(false); }}>
                  {isFullscreen ? '⛶ Salir Fullscreen' : '⛶ Fullscreen'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className={`backtesting-main-wrapper ${fullscreenPanel === 'chart' ? 'wrapper-fullscreen-chart' : ''}`}
        style={{
          position: 'relative',
          display: 'flex' // 🔧 FIX: Siempre flex para que la cadena de altura funcione
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
          className={`backtesting-main chart-with-sidebar ${drawingSidebarCollapsed ? 'sidebar-collapsed' : ''} ${drawingSidebarHidden ? 'sidebar-hidden' : ''} ${fullscreenPanel === 'chart' ? 'fullscreen-chart' : ''}`}
          style={{
            flex: fullscreenPanel === 'chart' ? '1' : (fullscreenPanel === 'trading' ? '0' : '1'),
            display: fullscreenPanel === 'trading' ? 'none' : 'flex'
          }}
        >
          {/* 🎯 OPTIMIZACIÓN UI: Tabs de timeframes movidos al header - Toolbar horizontal eliminado (ahora sidebar vertical) */}

          {/* 🎯 NUEVO: Contenedor de tabs - 5 MiniCharts (uno por timeframe) */}
          {/* Días por timeframe: calculados dinámicamente según fecha de inicio */}
          <div className="timeframes-container">
            {['1m', '5m', '15m', '1h', '4h'].map(tf => {
              // 🔧 FIX: Calcular días dinámicamente basándose en simulationStartTime
              // Esto evita descargar 5 años cuando solo necesitamos 1.5 años
              const calculateDaysNeeded = () => {
                // Límites máximos del backend (MAX_DAYS_BY_INTERVAL)
                const maxDaysMap = {
                  '1m': 730,    // 2 años máximo
                  '5m': 1825,   // 5 años máximo
                  '15m': 1825,  // 5 años máximo
                  '1h': 1825,   // 5 años máximo
                  '4h': 1825    // 5 años máximo
                };
                const maxDays = maxDaysMap[tf] || 1825;

                // Si hay fecha de inicio definida, calcular días reales necesarios
                if (simulationStartTime) {
                  const now = Date.now();
                  const daysNeeded = Math.ceil((now - simulationStartTime) / (24 * 60 * 60 * 1000));
                  // Usar el mínimo entre días necesarios y límite del backend
                  return Math.min(daysNeeded, maxDays);
                }

                // Sin fecha de inicio, usar el máximo permitido
                return maxDays;
              };

              const tfDays = calculateDaysNeeded();

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
                  isActive={activeTimeframe === tf}
                  indicatorStates={tabStates[tf]?.indicatorStates}
                  backtestingMode={true}
                  backtestingData={marketData}
                  currentTime={currentTime}
                  simulationStartTime={simulationStartTime}
                  vpConfig={tabStates[tf]?.vpConfig}
                  vpFixedRange={tabStates[tf]?.vpFixedRange}
                  oiMode={tabStates[tf]?.oiMode || 'histogram'}
                  onOpenVpSettings={handleOpenVpSettings}
                  onOpenRangeDetectionSettings={handleOpenRangeDetectionSettings}
                  onOpenRejectionPatternSettings={handleOpenRejectionPatternSettings}
                  onOpenSupportResistanceSettings={handleOpenSupportResistanceSettings}
                  onOpenVWAPSettings={handleOpenVWAPSettings}
                  onOpenDoubleTopBottomSettings={handleOpenDoubleTopBottomSettings}
                  onOpenSwingDetectorSettings={handleOpenSwingDetectorSettings}
                  onOpenOIVolumeConfluenceSettings={handleOpenOIVolumeConfluenceSettings}
                  rejectionPatternConfig={tabStates[tf]?.rejectionPatternConfig}
                  currentTool={currentTool}
                  onToolChange={setCurrentTool}
                  getTradeBoundaries={() => tradeBoundaries(orderManagerRef.current?.orders)}
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
                  onCandleClick={(timestamp) => {
                    // 🎯 Order Flow: Anclar footprint al hacer click en vela
                    handleToggleFootprintPin(timestamp);
                  }}
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
          {/* 🎯 OPTIMIZACIÓN UI: Header del panel con botones de maximizar y colapsar */}
          <div className="sidebar-header">
            <span className="sidebar-title">Panel de Trading</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="btn-collapse"
                onClick={() => setFullscreenPanel(prev => prev === 'trading' ? null : 'trading')}
                title={fullscreenPanel === 'trading' ? "Restaurar panel (ESC)" : "Maximizar panel (Shift+T)"}
                style={{ fontSize: '16px' }}
              >
                {fullscreenPanel === 'trading' ? '⛶' : '⛶'}
              </button>
              <button
                className="btn-collapse"
                onClick={() => setShowTradingPanel(false)}
                title="Ocultar panel (T o ESC)"
              >
                ✕
              </button>
            </div>
          </div>

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
              className={`tab-btn ${activePanel === 'observer' ? 'active' : ''}`}
              onClick={() => setActivePanel('observer')}
            >
              🔭 Observador{observerUnread > 0 ? ` (${observerUnread})` : ''}
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
                  symbol={symbol}
                  orderManager={orderManagerRef.current}
                  currentPrice={currentPrice}
                  currentTime={currentTime}
                  chartBox={latestFreeBox(chartShapes, orderManagerRef.current?.orders)}
                  onOrderCreated={(order) => {
                    console.log('[BacktestingApp] Orden creada:', order);
                    observeOrder(order);
                    if (order.status === 'pending') {
                      captureHold.run(release => captureDecision(order, miniChartRefs.current[activeTimeframeRef.current], release));
                    }

                    // Una orden que usa la caja dibujada la lleva a su entrada al abrir
                    if (order.tpslBoxId) {
                      if (order.status === 'open') {
                        miniChartRefs.current[activeTimeframe]?.anchorTPSLBox?.(order.tpslBoxId, order.executedAt, order.executedPrice);
                      }
                    } else if (order.type === 'market' && (order.stopLoss || order.takeProfit)) {
                      // 🎯 NUEVO: Crear caja TP/SL automática solo para market orders con SL y TP
                      const miniChart = miniChartRefs.current[activeTimeframe];
                      if (miniChart && miniChart.addTPSLBox) {
                        order.tpslBoxId = miniChart.addTPSLBox(
                          order.entryPrice,
                          order.openTime || currentTime,
                          order.side, // 'long' o 'short'
                          order.stopLoss,
                          order.takeProfit,
                          5 // 5 velas de ancho
                        );
                      }
                    }

                    saveTradeSession();
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
              <TradeHistory
                orderManager={orderManagerRef.current}
                onNavigateToTrade={handleNavigateToTrade}
              />
            )}

            {activePanel === 'dashboard' && (
              <TradingDashboard
                orderManager={orderManagerRef.current}
                symbol={symbol}
              />
            )}

            {activePanel === 'observer' && !observerPopup && (
              <ObserverPanel
                revision={observerRevision}
                symbol={symbol}
                sessionManager={sessionManager}
                viewer={observerViewer}
                blindActive={blindActive}
                onRevealDate={revealDate}
                onGoToItem={goToItem}
                onPopOut={popOutObserver}
              />
            )}

            {activePanel === 'observer' && observerPopup && (
              <div className="observer-panel">
                <div className="observer-note">El Observador está abierto en una ventana aparte.</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button type="button" className="btn-quick" onClick={() => observerPopup.focus()}>Ir a la ventana</button>
                  <button type="button" className="btn-quick" onClick={bringObserverBack}>Traerlo aquí</button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* 🎯 OPTIMIZACIÓN UI: Botón flotante para mostrar panel cuando está oculto */}
      {!showTradingPanel && (
        <button
          className="floating-panel-toggle"
          onClick={() => setShowTradingPanel(true)}
          title="Mostrar panel de trading (T)"
        >
          📊
        </button>
      )}

      {observerPopup && (
        <PopupWindow popup={observerPopup} title={`Observador · ${symbol}`} onClose={() => setObserverPopup(null)}>
          <div style={{ padding: 12 }}>
            <ObserverPanel
              revision={observerRevision}
              symbol={symbol}
              sessionManager={sessionManager}
              viewer={observerViewer}
              blindActive={blindActive}
              onRevealDate={revealDate}
              onGoToItem={(item) => { window.focus(); goToItem(item); }}
            />
          </div>
        </PopupWindow>
      )}

      {observerNotice && (
        <button
          type="button"
          className="observer-toast"
          onClick={() => {
            if (observerPopup && !observerPopup.closed) observerPopup.focus();
            else {
              setShowTradingPanel(true);
              setActivePanel('observer');
            }
            setObserverNotice(null);
          }}
        >
          Trade #{tradeLabel(observerNotice)} cerrado ({observerNotice.pnl >= 0 ? '+' : ''}${observerNotice.pnl.toFixed(2)}). Ver qué leyó la regla
        </button>
      )}

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
                config={{ ...vpConfig, ...(tabStates[activeTimeframe]?.vpConfig || {}) }}
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
              candles={closedCandles()}
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
          onShowModeChange={(mode) => applyToAllTimeframes(manager => manager.getRejectionPatternIndicator()?.setShowMode(mode))}
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
          onConfigChange={config => applyToAllTimeframes(manager => manager.supportResistance2Indicator?.updateConfig(config))}
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

      {showOrderFlowSettings && indicatorManagerRef.current && (
        <OrderFlowSettings
          symbol={symbol}
          indicator={indicatorManagerRef.current.getOrderFlowIndicator()}
          activeTimeframe={activeTimeframe}
          onApply={(settings) => applyToAllTimeframes(manager => manager.getOrderFlowIndicator().updateConfig(settings))}
          onClose={() => setShowOrderFlowSettings(false)}
        />
      )}

      {showFVGSettings && indicatorManagerRef.current && (
        <FVGSettings
          symbol={symbol}
          indicator={indicatorManagerRef.current.getFVGIndicator()}
          onApply={(settings) => applyToAllTimeframes(manager => manager.getFVGIndicator().updateConfig(settings))}
          onClose={() => setShowFVGSettings(false)}
        />
      )}

      {showVPPeriodicSettings && indicatorManagerRef.current && (
        <VPPeriodicSettings
          symbol={symbol}
          indicator={indicatorManagerRef.current.getVPPeriodicIndicator()}
          onApply={(settings) => applyToAllTimeframes(manager => manager.getVPPeriodicIndicator().updateConfig(settings))}
          onClose={() => setShowVPPeriodicSettings(false)}
        />
      )}

      {showResponseVolumeSettings && indicatorManagerRef.current && (
        <ResponseVolumeSettings
          symbol={symbol}
          indicator={indicatorManagerRef.current.getResponseVolumeIndicator()}
          onApply={(settings) => applyToAllTimeframes(manager => manager.getResponseVolumeIndicator().updateConfig(settings))}
          onClose={() => setShowResponseVolumeSettings(false)}
        />
      )}

      {showLiquidationsSettings && indicatorManagerRef.current && (
        <LiquidationsSettings
          symbol={symbol}
          indicator={indicatorManagerRef.current.getLiquidationsIndicator()}
          onApply={(settings) => applyToAllTimeframes(manager => manager.getLiquidationsIndicator().updateConfig(settings))}
          onClose={() => setShowLiquidationsSettings(false)}
        />
      )}

      {showOFElementsSettings && indicatorManagerRef.current && (
        <OrderFlowElementsSettings
          symbol={symbol}
          indicator={indicatorManagerRef.current.getOFElementsIndicator()}
          onApply={(settings) => applyToAllTimeframes(manager => manager.getOFElementsIndicator().updateConfig(settings))}
          onClose={() => setShowOFElementsSettings(false)}
          onOpenSetups={() => { setShowOFElementsSettings(false); setShowOFSetupsSettings(true); }}
        />
      )}

      {showOFSetupsSettings && indicatorManagerRef.current && (
        <OrderFlowSetupsSettings
          symbol={symbol}
          indicator={indicatorManagerRef.current.getOFElementsIndicator()}
          onApply={(config) => applyToAllTimeframes(manager => manager.getOFElementsIndicator().setSetupsConfig(config))}
          onClose={() => setShowOFSetupsSettings(false)}
        />
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

      {/* Modal de OI-Volume Confluence Settings */}
      {showOIVolumeConfluenceSettings && indicatorManagerRef.current && (
        <div className="modal-overlay" onClick={() => setShowOIVolumeConfluenceSettings(false)} style={{
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
              onClick={() => setShowOIVolumeConfluenceSettings(false)}
              style={{
                position: 'sticky',
                top: '8px',
                right: '8px',
                float: 'right',
                zIndex: 1,
                background: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                cursor: 'pointer',
                fontSize: '18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold'
              }}
              title="Cerrar"
            >
              ×
            </button>
            <OIVolumeConfluenceSettings
              config={indicatorManagerRef.current.getIndicatorConfig('OI-Volume Confluence') || {}}
              onConfigChange={async (newConfig) => {
                await indicatorManagerRef.current.applyConfig('OI-Volume Confluence', newConfig);

                // Forzar redibujado del chart
                const miniChart = miniChartRefs.current[activeTimeframe];
                if (miniChart && miniChart.forceRedraw) {
                  miniChart.forceRedraw();
                }
              }}
              currentSymbol={symbol}
              onClose={() => setShowOIVolumeConfluenceSettings(false)}
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
          getStateCallback={() => latestRef.current.captureCurrentState()}
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

      {/* 🎯 Order Flow Sidebar - Footprints anclados */}
      {pinnedFootprints.length > 0 && (
        <FootprintSidebar
          pinnedFootprints={pinnedFootprints}
          onTogglePin={handleToggleFootprintPin}
          onNavigate={handleNavigateToFootprint}
          orderFlowIndicator={
            miniChartRefs.current[activeTimeframe]?.indicatorManagerRef?.getOrderFlowIndicator?.()
          }
        />
      )}
    </div>
  );
};

export default BacktestingApp;
