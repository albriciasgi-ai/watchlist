// src/components/MiniChart.jsx
// ✅ SOLUCIÓN COMPLETA: Sincronización automática de indicadores + Detección de gaps

import React, { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../config";
import wsManager from "./WebSocketManager";
import IndicatorManager from "./indicators/IndicatorManager";
import PresetManager from "../utils/PresetManager";
import IndicatorManagerRegistry from "../utils/IndicatorManagerRegistry";
import FixedRangeProfilesManager from "./FixedRangeProfilesManager";
import VolumeProfileFixedSettings from "./VolumeProfileFixedSettings";
import ChartModal from "./drawing/ChartModal";
import TrendLine from "./drawing/shapes/TrendLine";
import HorizontalLine from "./drawing/shapes/HorizontalLine";
import VerticalLine from "./drawing/shapes/VerticalLine";
import Rectangle from "./drawing/shapes/Rectangle";
import FibonacciRetracement from "./drawing/shapes/FibonacciRetracement";
import TPSLBox from "./drawing/shapes/TPSLBox";
import TPSLBoxShort from "./drawing/shapes/TPSLBoxShort";
import MeasurementShape from "./drawing/shapes/MeasurementShape";
import TextBox from "./drawing/shapes/TextBox";
import DrawingToolManager from "./drawing/DrawingToolManager";
import AlertHistoryPanel from "./AlertHistoryPanel";
import FloatingToolbar from "./drawing/FloatingToolbar";
import ColorPickerModal from "./drawing/ColorPickerModal";
import MeasurementTool from "./drawing/MeasurementTool";
import TextEditModal from "./drawing/TextEditModal";
import Logger from '../utils/Logger.js';
import RenderManager from '../utils/RenderManager.js';
import CandleCache from '../utils/CandleCache.js';
import IndicatorCache from '../utils/IndicatorCache.js';

// Logger instance
const log = new Logger('MiniChart', { level: 'info' });

// ==================== CONFIGURACIÓN ====================
// Opacidad de los dibujos en el minichart (0.0 = transparente, 1.0 = opaco)
// Ajusta este valor si los dibujos no se ven bien en el minichart
const DRAWING_OPACITY = 0.7;

// ==================== HELPERS ====================

const formatDateTimeColombia = (timestamp) => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

const getIntervalMilliseconds = (interval) => {
  const map = {
    "1": 60000,
    "3": 180000,
    "5": 300000,
    "15": 900000,
    "30": 1800000,
    "60": 3600000,
    "120": 7200000,
    "240": 14400000,
    "D": 86400000,
    "W": 604800000
  };
  return map[interval] || 900000;
};

const formatCandleTime = (datetimeStr, interval) => {
  if (!datetimeStr) return "";
  const parts = datetimeStr.split(" ");
  const datePart = parts[0];
  const timePart = parts[1];
  
  const [year, month, day] = datePart.split("-");
  const [hours, minutes] = timePart.split(":");
  
  if (interval === "D" || interval === "W") {
    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    return `${day} ${monthNames[parseInt(month) - 1]}`;
  }
  
  if (interval === "60" || interval === "240") {
    return `${hours}:00`;
  }
  
  return `${hours}:${minutes}`;
};

const formatAxisTime = (datetimeStr, prevDatetimeStr) => {
  if (!datetimeStr) return "";
  
  const parts = datetimeStr.split(" ");
  const datePart = parts[0];
  const timePart = parts[1];
  
  const [year, month, day] = datePart.split("-");
  const [hours, minutes] = timePart.split(":");
  
  const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  
  if (!prevDatetimeStr || prevDatetimeStr.split(" ")[0] !== datePart) {
    return `${day} ${monthNames[parseInt(month) - 1]} ${hours}:${minutes}`;
  }
  
  return `${hours}:${minutes}`;
};

// ==================== MAIN COMPONENT ====================

const MiniChart = ({ symbol, interval, days, indicatorStates, vpConfig, vpFixedRange, oiMode, externalIndicatorManager = null, externalDrawingManager = null, externalDrawingMode = false, onDrawingModeChange = null, onOpenVpSettings, onOpenRangeDetectionSettings, onOpenRejectionPatternSettings, onOpenSupportResistanceSettings, onOpenVWAPSettings, onOpenFibonacciSettings, onOpenContinuationPatternSettings, onOpenDoubleTopBottomSettings, onOpenSwingDetectorSettings, rejectionPatternConfig, onFullscreenChange, isFullscreenChild = false, onDrawingsChanged = null, onChartLoaded = null }) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null); // 🎯 VIRTUALIZACIÓN: Ref para el contenedor principal

  const candlesRef = useRef([]);
  const inProgressCandleRef = useRef(null);

  const lastPriceRef = useRef(null);
  const animationFrameRef = useRef(null);
  const mountedRef = useRef(true);
  const indicatorManagerRef = useRef(null);
  const drawingsRef = useRef([]);
  const renderManagerRef = useRef(null);

  // ✅ NUEVO: Referencia para chequeo de gaps
  const gapCheckIntervalRef = useRef(null);

  const [mousePos, setMousePos] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isVisible, setIsVisible] = useState(true); // 🎯 VIRTUALIZACIÓN: Estado de visibilidad
  const [isInitialized, setIsInitialized] = useState(false); // 🎯 VIRTUALIZACIÓN: Estado de inicialización
  const [fullscreenOiMode, setFullscreenOiMode] = useState(oiMode || "histogram");
  const [showFixedRangeManager, setShowFixedRangeManager] = useState(false);

  // Estados para modo dibujo inline
  const [internalDrawingMode, setInternalDrawingMode] = useState(false);
  const [selectedDrawingTool, setSelectedDrawingTool] = useState('select');
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [shapeBeingColored, setShapeBeingColored] = useState(null);
  const [isTextEditModalOpen, setIsTextEditModalOpen] = useState(false);
  const [textBoxBeingEdited, setTextBoxBeingEdited] = useState(null);
  const lastDoubleClickRef = useRef(0); // Para debounce de doble-click
  const lastMouseMoveRef = useRef(0); // Para throttle de mousemove
  const pendingMouseMoveRef = useRef(null); // RAF ID para mousemove pendiente
  const internalDrawingManagerRef = useRef(null); // DrawingToolManager para dibujo inline
  const scaleConverterRef = useRef(null); // Scale converter para conversión de coordenadas
  const measurementToolRef = useRef(null); // MeasurementTool para mediciones temporales
  const lastTextBoxClickTimeRef = useRef(0); // Para detectar doble-click en TextBox
  const lastTextBoxClickedIdRef = useRef(null); // ID del TextBox clickeado

  // Usar drawing manager externo si está disponible (para compartir entre grid y fullscreen)
  const drawingManagerRef = externalDrawingManager ? { current: externalDrawingManager } : internalDrawingManagerRef;
  const drawingMode = externalDrawingMode !== undefined && onDrawingModeChange ? externalDrawingMode : internalDrawingMode;
  const setDrawingMode = onDrawingModeChange || setInternalDrawingMode;

  // Ref para drawingMode (para uso en drawChart sin depender del closure)
  const drawingModeRef = useRef(drawingMode);
  drawingModeRef.current = drawingMode;

  // Actualizar fullscreenOiMode cuando cambia oiMode del padre
  useEffect(() => {
    if (oiMode) {
      setFullscreenOiMode(oiMode);
    }
  }, [oiMode]);

  // 🎯 VIRTUALIZACIÓN: Detectar visibilidad con IntersectionObserver
  useEffect(() => {
    // No virtualizar charts fullscreen o hijos de fullscreen
    if (isFullscreen || isFullscreenChild) {
      setIsVisible(true);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const nowVisible = entry.isIntersecting;
          // Usar functional update para evitar stale closure
          setIsVisible(prev => {
            if (prev !== nowVisible) {
              log.debug(`[${symbol}] 👁️ Visibility: ${nowVisible ? 'VISIBLE' : 'HIDDEN'}`);
            }
            return nowVisible;
          });
        });
      },
      {
        root: null, // viewport
        rootMargin: '100px', // Pre-cargar 100px antes de entrar al viewport
        threshold: 0.1 // 10% visible es suficiente
      }
    );

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [symbol, isFullscreen, isFullscreenChild]);

  // 🎯 Ajustar zoom al abrir fullscreen
  useEffect(() => {
    if (isFullscreen && canvasRef.current && candlesRef.current.length > 0) {
      // Resetear escala de precios para recalcular en fullscreen
      priceScaleRef.current.minPrice = null;
      priceScaleRef.current.maxPrice = null;

      // Ajustar zoom para mostrar ~1222 velas en fullscreen
      const rect = canvasRef.current.getBoundingClientRect();
      const chartWidth = rect.width - 75;
      const targetCandles = 1222;
      const calculatedZoom = chartWidth / (targetCandles * 8);
      viewStateRef.current.zoom = Math.max(0.1, Math.min(5, calculatedZoom));

      log.debug(`[${symbol}] 🎯 Fullscreen: zoom ajustado a ${viewStateRef.current.zoom.toFixed(2)} para ~${targetCandles} velas`);

      // Forzar redibujado
      setTimeout(() => {
        drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
      }, 100);
    }
  }, [isFullscreen]);

  // 📡 Notificar al padre cuando cambia el estado fullscreen
  useEffect(() => {
    console.log(`[MiniChart ${symbol}] 🖥️ Fullscreen effect: isFullscreen=${isFullscreen}, hasCallback=${!!onFullscreenChange}`);
    if (onFullscreenChange) {
      onFullscreenChange(symbol, interval, isFullscreen);
    }
  }, [isFullscreen, symbol, interval, onFullscreenChange]);

  // 🎨 Handler de teclado para modo dibujo (ESC, Delete, Ctrl+Z, Ctrl+Y)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!drawingMode) return;

      // 🛡️ Si el padre tiene fullscreen abierto, no procesar eventos (el hijo los maneja)
      if (isFullscreen && !isFullscreenChild) {
        return;
      }

      // 🛡️ Ignorar shortcuts cuando hay un modal de edición de texto abierto
      // o cuando el foco está en un elemento de entrada
      if (isTextEditModalOpen) {
        // Solo permitir ESC para cerrar el modal
        if (e.key !== 'Escape') {
          return;
        }
      }

      // 🛡️ También detectar si hay un TextEditModal abierto en el DOM (para fullscreen)
      const textEditModalOpen = document.querySelector('.text-edit-modal-overlay');
      if (textEditModalOpen && e.key !== 'Escape') {
        return; // No interceptar teclas cuando hay modal de texto abierto
      }

      const activeElement = document.activeElement;
      const isInputFocused = activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable ||
        activeElement.closest('.text-edit-modal-content') ||
        activeElement.closest('.color-picker-modal-content')
      );

      // Solo permitir ESC cuando hay input focuseado (para cerrar modales)
      if (isInputFocused && e.key !== 'Escape') {
        return; // No interceptar otras teclas cuando se está escribiendo
      }

      // ESC - Cerrar modo dibujo o cancelar medición
      if (e.key === 'Escape') {
        // Primero: limpiar medición si existe
        if (measurementToolRef.current && (measurementToolRef.current.isMeasuring || measurementToolRef.current.startPoint)) {
          measurementToolRef.current.clear();
          drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
          return;
        }
        // Segundo: cancelar dibujo en progreso si existe
        if (drawingManagerRef.current && drawingManagerRef.current.isDrawing()) {
          drawingManagerRef.current.cancelDrawing();
          drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
          return;
        }
        // Si no hay nada que cancelar, cerrar modo dibujo
        setDrawingMode(false);
        return;
      }

      // Delete - Eliminar shape seleccionado
      if (e.key === 'Delete' && drawingManagerRef.current) {
        if (drawingManagerRef.current.selectedShape) {
          drawingManagerRef.current.deleteSelected();
          saveDrawingsInline();
          drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
        }
        return;
      }

      // Ctrl+Z - Deshacer
      if (e.ctrlKey && e.key === 'z' && drawingManagerRef.current) {
        drawingManagerRef.current.undo();
        saveDrawingsInline();
        drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
        return;
      }

      // Ctrl+Y - Rehacer
      if (e.ctrlKey && e.key === 'y' && drawingManagerRef.current) {
        drawingManagerRef.current.redo();
        saveDrawingsInline();
        drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
        return;
      }

      // Shortcuts de herramientas (sin modificadores)
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        const key = e.key.toLowerCase();
        switch (key) {
          case 'v': setSelectedDrawingTool('select'); break;
          case 't': setSelectedDrawingTool('trendline'); break;
          case 'h': setSelectedDrawingTool('horizontal'); break;
          case 'l': setSelectedDrawingTool('vertical'); break;
          case 'r': setSelectedDrawingTool('rectangle'); break;
          case 'f': setSelectedDrawingTool('fibonacci'); break;
          case 'p': setSelectedDrawingTool('tpsl'); break;
          case 's': setSelectedDrawingTool('tpsl-short'); break;
          case 'n': setSelectedDrawingTool('textbox'); break;
          case 'c':
            // C - Cambiar color de línea seleccionada
            if (drawingManagerRef.current && drawingManagerRef.current.selectedShape) {
              const shape = drawingManagerRef.current.selectedShape;
              if (['trendline', 'horizontal', 'vertical'].includes(shape.type)) {
                e.preventDefault();
                setShapeBeingColored(shape);
                setIsColorPickerOpen(true);
              }
            }
            break;
        }
      }
    };

    if (drawingMode) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [drawingMode, mousePos]);

  // 🎨 Inicializar DrawingToolManager y MeasurementTool cuando se activa el modo dibujo
  useEffect(() => {
    if (drawingMode && !externalDrawingManager) {
      if (!internalDrawingManagerRef.current) {
        // Primera vez: crear el manager
        internalDrawingManagerRef.current = new DrawingToolManager(
          symbol,
          interval,
          setSelectedDrawingTool,
          () => {
            // Callback cuando se agrega un shape - guardar y forzar re-render
            saveDrawingsInline();
            drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
          }
        );
      }
      // 🔄 FIX: SIEMPRE cargar dibujos al entrar al modo dibujo (no solo la primera vez)
      // Esto asegura que el manager tenga los shapes más recientes del servidor
      loadDrawingsIntoManager();
    }
    // Inicializar MeasurementTool cuando se activa el modo dibujo
    if (drawingMode && !measurementToolRef.current) {
      measurementToolRef.current = new MeasurementTool();
    }
  }, [drawingMode, symbol, interval, externalDrawingManager]);

  // 🎨 Sincronizar herramienta seleccionada con DrawingToolManager
  useEffect(() => {
    if (drawingManagerRef.current && drawingMode) {
      drawingManagerRef.current.setTool(selectedDrawingTool);
    }
  }, [selectedDrawingTool, drawingMode]);

  // 🔄 FIX: Guardar dibujos al salir del modo dibujo para evitar que rectángulos borrados reaparezcan
  const prevDrawingModeRef = useRef(drawingMode);
  useEffect(() => {
    // Detectar transición de drawingMode: true -> false
    if (prevDrawingModeRef.current && !drawingMode) {
      // Saliendo del modo dibujo - guardar cambios y sincronizar
      if (drawingManagerRef.current) {
        log.info(`[MiniChart] 🔄 Exiting drawing mode - saving shapes`);
        // saveDrawingsInline() ya sincroniza drawingsRef, guarda al servidor y fuerza re-render
        saveDrawingsInline();
      }
    }
    prevDrawingModeRef.current = drawingMode;
  }, [drawingMode]);

  const [fixedRangeProfiles, setFixedRangeProfiles] = useState([]);
  const [configuringProfileId, setConfiguringProfileId] = useState(null);
  const [currentProfileConfig, setCurrentProfileConfig] = useState(null);
  const [showChartModal, setShowChartModal] = useState(false);
  const [showAlertHistory, setShowAlertHistory] = useState(false);
  const [drawingsVersion, setDrawingsVersion] = useState(0); // ✅ FIX: Estado para forzar re-render al cargar drawings
  const viewStateRef = useRef({ offset: 0, zoom: 1, verticalOffset: 0 });
  const dragStateRef = useRef({ isDragging: false, startX: 0, startY: 0, startOffset: 0, startVerticalOffset: 0 });
  const priceScaleRef = useRef({ minPrice: null, maxPrice: null, lastZoom: 1 }); // Guardar escala de precios

  const getBybitInterval = (interval) => {
    const map = {
      "1": "1", "3": "3", "5": "5", "15": "15", "30": "30",
      "60": "60", "120": "120", "240": "240", "D": "D", "W": "W"
    };
    return map[interval] || "15";
  };

  // ==================== DRAWINGS ====================

  const deserializeShape = (data) => {
    switch (data.type) {
      case 'trendline':
        return TrendLine.deserialize(data);
      case 'horizontal':
        return HorizontalLine.deserialize(data);
      case 'vertical':
        return VerticalLine.deserialize(data);
      case 'rectangle':
        return Rectangle.deserialize(data);
      case 'fibonacci':
        return FibonacciRetracement.deserialize(data);
      case 'tpsl':
        return TPSLBox.deserialize(data);
      case 'tpsl-short':
        return TPSLBoxShort.deserialize(data);
      case 'measurement':
        return MeasurementShape.deserialize(data);
      case 'textbox':
        return TextBox.deserialize(data);
      default:
        log.warn('Unknown shape type:', data.type);
        return null;
    }
  };

  // 🔄 Ref para tracking de timestamp de dibujos (sincronización entre apps)
  const drawingsTimestampRef = useRef(null);

  const loadDrawings = async (checkTimestampOnly = false) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/drawings/${symbol}`);
      const data = await response.json();

      // 🔄 Si solo verificamos timestamp y no cambió, no recargar
      if (checkTimestampOnly && data.updated_at === drawingsTimestampRef.current) {
        return; // Sin cambios, no hacer nada
      }

      // Actualizar timestamp
      drawingsTimestampRef.current = data.updated_at;

      if (data.shapes && Array.isArray(data.shapes)) {
        drawingsRef.current = data.shapes
          .map(shapeData => deserializeShape(shapeData))
          .filter(shape => shape !== null);
      } else {
        drawingsRef.current = [];
      }

      // ✅ FIX: Incrementar versión para forzar re-render y mostrar trendlines
      setDrawingsVersion(v => v + 1);
    } catch (error) {
      log.error(`Error loading drawings for ${symbol}:`, error);
      drawingsRef.current = [];
      setDrawingsVersion(v => v + 1); // Forzar re-render incluso en error
    }
  };

  // 🎨 Guardar dibujos inline al servidor
  const saveDrawingsInline = async () => {
    if (!drawingManagerRef.current) return;

    try {
      const shapes = drawingManagerRef.current.getShapes();

      // 🔄 Sincronizar drawingsRef INMEDIATAMENTE (antes de la llamada al servidor)
      // para evitar parpadeo mientras se guarda
      drawingsRef.current = shapes
        .map(shapeData => deserializeShape(shapeData))
        .filter(shape => shape !== null);

      // Guardar al servidor (async, no bloquea el render)
      await fetch(`${API_BASE_URL}/api/drawings/${symbol}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shapes })
      });
      log.info(`[MiniChart] 💾 Saved ${shapes.length} inline drawings for ${symbol}`);

      setDrawingsVersion(v => v + 1);

      // 🔔 Notificar al padre que hubo cambios en los dibujos
      if (onDrawingsChanged) {
        onDrawingsChanged();
      }
    } catch (error) {
      log.error(`Error saving inline drawings for ${symbol}:`, error);
    }
  };

  // 🎨 Cargar dibujos al DrawingToolManager
  const loadDrawingsIntoManager = async () => {
    if (!drawingManagerRef.current) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/drawings/${symbol}`);
      const data = await response.json();

      if (data.shapes && Array.isArray(data.shapes)) {
        drawingManagerRef.current.loadShapes(data.shapes);
        log.info(`[MiniChart] 🎨 Loaded ${data.shapes.length} drawings into DrawingToolManager`);
        // Forzar redibujado
        drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
      }
    } catch (error) {
      log.error(`Error loading drawings into manager for ${symbol}:`, error);
    }
  };

  // ==================== DRAW CHART ====================
  
  const drawChart = (candles, livePrice = null, mouseX = null, mouseY = null) => {
    if (!mountedRef.current) return;
    
    const canvas = canvasRef.current;
    if (!canvas || candles.length === 0) return;

    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);

    if (width === 0 || height === 0) return;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const bullColor = "#34C759";
    const bearColor = "#FF3B30";
    const axisColor = "#DDE2E7";
    const textColor = "#666";

    const marginLeft = 10;
    const marginRight = 65;
    const marginTop = 25;
    const timeAxisHeight = 25;
    
    const baseVolumeHeight = 50;
    const minPriceChartHeight = 180;
    
    let desiredIndicatorsHeight = 0;
    if (indicatorManagerRef.current) {
      desiredIndicatorsHeight = indicatorManagerRef.current.getTotalHeight();
    }
    
    const availableHeight = height - marginTop - timeAxisHeight;
    const totalNeeded = minPriceChartHeight + baseVolumeHeight + desiredIndicatorsHeight;
    
    let priceChartHeight, volumeHeight, indicatorsHeight, heightScale;
    
    if (availableHeight >= totalNeeded) {
      volumeHeight = baseVolumeHeight;
      indicatorsHeight = desiredIndicatorsHeight;
      heightScale = 1.0;
      priceChartHeight = availableHeight - volumeHeight - indicatorsHeight;
    } else {
      const scale = availableHeight / totalNeeded;
      priceChartHeight = Math.floor(minPriceChartHeight * scale);
      volumeHeight = Math.floor(baseVolumeHeight * scale);
      indicatorsHeight = Math.floor(desiredIndicatorsHeight * scale);
      heightScale = scale;
      
      const actualTotal = priceChartHeight + volumeHeight + indicatorsHeight;
      if (actualTotal > availableHeight) {
        priceChartHeight -= (actualTotal - availableHeight);
      }
    }
    
    if (indicatorManagerRef.current) {
      indicatorManagerRef.current.setHeightScale(heightScale);
    }
    
    const marginBottom = volumeHeight + timeAxisHeight + indicatorsHeight;

    let displayCandles = [...candles];
    
    if (inProgressCandleRef.current) {
      displayCandles.push(inProgressCandleRef.current);
    }

    displayCandles = displayCandles.filter(d => 
      d.open > 0 && d.high > 0 && d.low > 0 && d.close > 0 &&
      d.high >= d.low && d.high >= d.open && d.high >= d.close &&
      d.low <= d.open && d.low <= d.close
    );

    const chartWidth = width - marginLeft - marginRight;

    // ✅ FIX: Zoom manual con rueda del mouse
    const minCandleWidth = 1;  // Permitir zoom out hasta 1px por vela
    const maxCandleWidth = 15;
    let candlesPerScreen, barWidth;

    // Calcular barWidth basado en zoom manual (rueda del mouse)
    barWidth = Math.max(minCandleWidth, Math.min(maxCandleWidth, 8 * viewStateRef.current.zoom));
    candlesPerScreen = Math.floor(chartWidth / barWidth);

    const maxOffset = Math.max(0, displayCandles.length - candlesPerScreen);
    const offset = Math.min(viewStateRef.current.offset, maxOffset);

    const startIdx = Math.max(0, displayCandles.length - candlesPerScreen - offset);
    const endIdx = Math.min(displayCandles.length, startIdx + candlesPerScreen);
    const visibleCandles = displayCandles.slice(startIdx, endIdx);

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);

    if (visibleCandles.length === 0) return;

    // 🎯 Escala de precios inteligente:
    // - Recalcular SOLO cuando cambia el zoom (zoom in/out)
    // - Mantener la misma escala durante paneo horizontal
    let minPrice, maxPrice;

    const currentZoom = viewStateRef.current.zoom;
    const zoomChanged = Math.abs(currentZoom - priceScaleRef.current.lastZoom) > 0.001;

    if (zoomChanged || priceScaleRef.current.minPrice === null) {
      // Zoom cambió o primera carga: recalcular escala basándose en velas visibles
      minPrice = Math.min(...visibleCandles.map(d => d.low));
      maxPrice = Math.max(...visibleCandles.map(d => d.high));

      // Guardar para mantener durante paneo
      priceScaleRef.current.minPrice = minPrice;
      priceScaleRef.current.maxPrice = maxPrice;
      priceScaleRef.current.lastZoom = currentZoom;
    } else {
      // Zoom no cambió (solo paneo): usar escala guardada
      minPrice = priceScaleRef.current.minPrice;
      maxPrice = priceScaleRef.current.maxPrice;
    }

    const priceRange = maxPrice - minPrice;

    // 🎯 NUEVO: Aplicar zoom vertical (Ctrl + rueda del mouse) y offset vertical (paneo)
    const verticalZoom = viewStateRef.current.verticalZoom || 1;
    const verticalOffset = viewStateRef.current.verticalOffset || 0;
    const baseYScale = priceRange > 0 ? priceChartHeight / priceRange : 1;
    const yScale = baseYScale * verticalZoom;

    const maxVolume = Math.max(...visibleCandles.map(d => d.volume));
    const volumeScale = maxVolume > 0 ? volumeHeight / maxVolume : 1;

    // ✅ barWidth ya fue calculado arriba con la lógica de auto-compress

    ctx.strokeStyle = axisColor;
    ctx.fillStyle = textColor;
    ctx.font = "10px Inter, sans-serif";
    ctx.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
      const price = minPrice + (priceRange * i / 4);
      const y = marginTop + priceChartHeight - (price - minPrice) * yScale + verticalOffset;
      
      ctx.beginPath();
      ctx.moveTo(marginLeft, y);
      ctx.lineTo(width - marginRight, y);
      ctx.stroke();
      
      ctx.fillText(price.toFixed(2), width - marginRight + 5, y + 4);
    }

    if (indicatorManagerRef.current) {
      const overlayBounds = {
        x: marginLeft,
        y: marginTop,
        width: chartWidth,
        height: priceChartHeight
      };

      // 🎯 NUEVO: Función para convertir precio a coordenada Y en el canvas
      const priceToY = (price) => {
        return marginTop + priceChartHeight - (price - minPrice) * yScale + verticalOffset;
      };

      // ✅ FIX: Función para convertir timestamp a coordenada X en el canvas
      const timeToX = (timestamp) => {
        if (displayCandles.length === 0) return null;

        let closestIndex = 0;
        let minDiff = Math.abs(displayCandles[0].timestamp - timestamp);

        for (let i = 1; i < displayCandles.length; i++) {
          const diff = Math.abs(displayCandles[i].timestamp - timestamp);
          if (diff < minDiff) {
            minDiff = diff;
            closestIndex = i;
          }
        }

        const relativeIndex = closestIndex - startIdx;
        const barWidth = chartWidth / visibleCandles.length;
        return marginLeft + (relativeIndex * barWidth) + (barWidth / 2);
      };

      // 🎯 NUEVO: Pasar información de zoom vertical, offset y rango de precios
      const priceContext = {
        minPrice,
        maxPrice,
        priceRange,
        verticalZoom,
        verticalOffset,
        yScale,
        priceToY,  // ✨ Función para que los indicadores puedan convertir precios a coordenadas Y
        timeToX    // ✅ FIX: Función para que los indicadores puedan convertir timestamps a coordenadas X
      };
      // Pasar drawings como manualLevels para que RejectionPatternIndicator pueda usarlos
      indicatorManagerRef.current.renderOverlays(ctx, overlayBounds, visibleCandles, displayCandles, priceContext, drawingsRef.current);
    }

    // Render saved drawings (readonly, below candles) o crear scaleConverter para modo dibujo
    // Siempre crear scaleConverter si hay drawingManager con shapes o si drawingMode está activo
    // Usar drawingModeRef.current para obtener el valor actual sin depender del closure
    const currentDrawingMode = drawingModeRef.current;
    const hasInlineDrawings = drawingManagerRef.current && drawingManagerRef.current.shapes && drawingManagerRef.current.shapes.length > 0;
    if (drawingsRef.current.length > 0 || currentDrawingMode || hasInlineDrawings) {
      const scaleConverter = {
        candles: displayCandles,
        visibleCandles,
        startIdx,
        endIdx,
        minPrice,
        maxPrice,
        priceRange,
        verticalZoom,
        verticalOffset,
        chartWidth,
        chartHeight: priceChartHeight,
        marginLeft,
        marginTop,
        interval,

        priceToY: (price) => {
          return marginTop + priceChartHeight - (price - minPrice) * yScale + verticalOffset;
        },

        yToPrice: (y) => {
          const relativeY = y - marginTop - verticalOffset;
          return minPrice + (priceChartHeight - relativeY) / yScale;
        },

        timeToX: (timestamp) => {
          // Find closest candle instead of exact match (for multi-timeframe support)
          if (displayCandles.length === 0) return null;

          let closestIndex = 0;
          let minDiff = Math.abs(displayCandles[0].timestamp - timestamp);

          for (let i = 1; i < displayCandles.length; i++) {
            const diff = Math.abs(displayCandles[i].timestamp - timestamp);
            if (diff < minDiff) {
              minDiff = diff;
              closestIndex = i;
            }
          }

          // ✅ FIX: Permitir coordenadas fuera del viewport para que dibujos parcialmente visibles se rendericen
          const relativeIndex = closestIndex - startIdx;
          return marginLeft + (relativeIndex * barWidth) + (barWidth / 2);
        },

        xToTime: (x) => {
          const relativeX = x - marginLeft;
          const candleIndex = startIdx + Math.floor(relativeX / barWidth);
          return displayCandles[candleIndex]?.timestamp || null;
        }
      };

      // 🎨 Guardar scaleConverter para uso en event handlers de dibujo
      scaleConverterRef.current = scaleConverter;

      // 🎨 Renderizar dibujos:
      // - En modo dibujo: usar DrawingToolManager (permite edición)
      // - Fuera de modo dibujo: usar drawingsRef (readonly desde servidor)
      // NOTA: No mezclar ambas fuentes para evitar parpadeo

      if (currentDrawingMode && drawingManagerRef.current) {
        // Modo editable: renderizar desde DrawingToolManager
        drawingManagerRef.current.render(ctx, scaleConverter);
      } else if (drawingsRef.current.length > 0) {
        // Modo readonly: renderizar desde drawingsRef (dibujos guardados del servidor)
        ctx.globalAlpha = DRAWING_OPACITY;
        drawingsRef.current.forEach(shape => {
          try {
            shape.render(ctx, scaleConverter, false, false, false);
          } catch (error) {
            log.error('Error rendering shape:', error);
          }
        });
        ctx.globalAlpha = 1.0;
      }

      // 📏 Renderizar MeasurementTool (encima de todo)
      if (measurementToolRef.current && (measurementToolRef.current.isMeasuring || measurementToolRef.current.startPoint)) {
        measurementToolRef.current.render(ctx, scaleConverter);
      }
    }

    ctx.lineWidth = 1;
    visibleCandles.forEach((d, i) => {
      const x = marginLeft + (i * barWidth);
      const yOpen = marginTop + priceChartHeight - (d.open - minPrice) * yScale + verticalOffset;
      const yClose = marginTop + priceChartHeight - (d.close - minPrice) * yScale + verticalOffset;
      const yHigh = marginTop + priceChartHeight - (d.high - minPrice) * yScale + verticalOffset;
      const yLow = marginTop + priceChartHeight - (d.low - minPrice) * yScale + verticalOffset;

      const color = d.close >= d.open ? bullColor : bearColor;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;

      ctx.beginPath();
      ctx.moveTo(x + barWidth / 2, yHigh);
      ctx.lineTo(x + barWidth / 2, yLow);
      ctx.stroke();

      const bodyHeight = Math.abs(yClose - yOpen);
      const bodyWidth = Math.max(barWidth * 0.7, 2);
      
      if (bodyHeight < 2) {
        const y = (yOpen + yClose) / 2;
        ctx.fillRect(x + (barWidth - bodyWidth) / 2, y - 1.5, bodyWidth, 3);
      } else {
        const topY = Math.min(yOpen, yClose);
        ctx.fillRect(x + (barWidth - bodyWidth) / 2, topY, bodyWidth, Math.max(bodyHeight, 2));
      }
    });

    // ✅ NUEVO: Línea horizontal de precio actual
    if (displayCandles.length > 0) {
      const lastCandle = displayCandles[displayCandles.length - 1]; // Incluye velas en progreso
      const currentPrice = lastCandle.close;
      const priceY = marginTop + priceChartHeight - (currentPrice - minPrice) * yScale + verticalOffset;

      // Color según dirección de la vela (verde si alcista, roja si bajista)
      const priceLineColor = lastCandle.close >= lastCandle.open ? bullColor : bearColor;

      // Línea punteada delgada
      ctx.strokeStyle = priceLineColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(marginLeft, priceY);
      ctx.lineTo(width - marginRight, priceY);
      ctx.stroke();
      ctx.setLineDash([]); // Resetear dash

      // Label del precio en el eje derecho (opcional, pequeño)
      const priceLabel = currentPrice.toFixed(2);
      const labelPadding = 4;
      const labelWidth = 58;
      const labelHeight = 16;

      ctx.fillStyle = priceLineColor;
      ctx.fillRect(width - marginRight + 2, priceY - labelHeight / 2, labelWidth, labelHeight);

      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 10px Inter, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(priceLabel, width - marginRight + 2 + labelPadding, priceY);
    }

    const volumeStartY = marginTop + priceChartHeight + 5;
    ctx.globalAlpha = 0.6;
    visibleCandles.forEach((d, i) => {
      const x = marginLeft + (i * barWidth);
      const volHeight = d.volume * volumeScale;
      const color = d.close >= d.open ? bullColor : bearColor;

      ctx.fillStyle = color;
      ctx.fillRect(x + barWidth * 0.1, volumeStartY + volumeHeight - volHeight, barWidth * 0.8, volHeight);
    });
    ctx.globalAlpha = 1.0;

    ctx.fillStyle = textColor;
    ctx.font = "9px Inter, sans-serif";
    ctx.fillText("Vol", marginLeft + 2, volumeStartY + 12);

    // ✅ Draw VWAP volatility bars below volume panel
    const vwapIndicator = indicatorManagerRef.current?.getVWAPIndicator();
    if (vwapIndicator && vwapIndicator.enabled) {
      const volatilityBarsStartY = volumeStartY + volumeHeight + 5;
      vwapIndicator.renderVolatilityBars(
        ctx,
        marginLeft,
        volatilityBarsStartY,
        width - marginLeft - marginRight,
        barWidth,
        visibleCandles
      );
    }

    const timeStep = Math.max(Math.floor(visibleCandles.length / 5), 1);
    const timeY = volumeStartY + volumeHeight + 15;
    
    ctx.fillStyle = textColor;
    ctx.font = "10px Inter, sans-serif";
    
    for (let i = 0; i < visibleCandles.length; i += timeStep) {
      const candle = visibleCandles[i];
      const prevCandle = i > 0 ? visibleCandles[i - timeStep] : null;
      const x = marginLeft + (i * barWidth) + (barWidth / 2);
      
      const timeText = formatAxisTime(candle.datetime_colombia, prevCandle?.datetime_colombia);
      const textWidth = ctx.measureText(timeText).width;
      ctx.fillText(timeText, x - textWidth / 2, timeY);
    }

    ctx.fillStyle = "#222";
    ctx.font = "bold 13px Inter, sans-serif";
    ctx.fillText(symbol, marginLeft + 5, 18);

    ctx.fillStyle = "#666";
    ctx.font = "10px Inter, sans-serif";
    const candleInfo = `${visibleCandles.length}/${displayCandles.length} velas`;
    ctx.fillText(candleInfo, marginLeft + 80, 18);

    // 🎯 NUEVO: Mostrar timeframe en la esquina superior derecha
    ctx.fillStyle = "#2196F3";
    ctx.font = "bold 14px Inter, sans-serif";
    const timeframeText = interval;
    const timeframeWidth = ctx.measureText(timeframeText).width;
    ctx.fillRect(width - marginRight - timeframeWidth - 16, 6, timeframeWidth + 12, 20);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(timeframeText, width - marginRight - timeframeWidth - 10, 20);

    if (indicatorManagerRef.current && indicatorsHeight > 0) {
      const indicatorsBounds = {
        x: marginLeft,
        y: marginTop + priceChartHeight + volumeHeight + timeAxisHeight,
        width: chartWidth,
        height: indicatorsHeight
      };
      indicatorManagerRef.current.renderIndicators(ctx, indicatorsBounds, visibleCandles);
    }

    // 🎯 NUEVO: Crosshair estilo TradingView - mostrar info en los ejes
    if (mouseX !== null && mouseY !== null) {
      // Línea vertical del crosshair
      if (mouseX >= marginLeft && mouseX <= width - marginRight) {
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2; // Más grueso para mejor visibilidad
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(mouseX, marginTop);
        ctx.lineTo(mouseX, height - timeAxisHeight);
        ctx.stroke();
        ctx.setLineDash([]);

        // 🎯 NUEVO: Mostrar fecha/hora interpolada en el eje X (abajo)
        // Calcular posición exacta del mouse en relación a las velas
        const mousePositionInChart = (mouseX - marginLeft) / barWidth;
        const candleIdx = Math.floor(mousePositionInChart);

        if (visibleCandles.length > 0 && candleIdx >= -1 && candleIdx <= visibleCandles.length) {
          let interpolatedTimestamp;

          if (candleIdx < 0) {
            // Mouse a la izquierda de la primera vela
            interpolatedTimestamp = visibleCandles[0].timestamp;
          } else if (candleIdx >= visibleCandles.length - 1) {
            // Mouse a la derecha de la última vela
            interpolatedTimestamp = visibleCandles[visibleCandles.length - 1].timestamp;
          } else {
            // Mouse entre velas - interpolar
            const candle1 = visibleCandles[candleIdx];
            const candle2 = visibleCandles[candleIdx + 1];
            const fraction = mousePositionInChart - candleIdx;

            // Interpolar timestamp linealmente
            interpolatedTimestamp = candle1.timestamp + (candle2.timestamp - candle1.timestamp) * fraction;
          }

          // Formatear fecha sin año: "DD MMM HH:mm"
          const date = new Date(interpolatedTimestamp);
          const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
          const day = date.getDate();
          const month = months[date.getMonth()];
          const hours = String(date.getHours()).padStart(2, '0');
          const minutes = String(date.getMinutes()).padStart(2, '0');
          const dateText = `${day} ${month} ${hours}:${minutes}`;

          const textWidth = ctx.measureText(dateText).width;
          const labelX = mouseX - textWidth / 2;
          const labelY = height - timeAxisHeight / 2;

          ctx.fillStyle = "#333";
          ctx.fillRect(labelX - 4, labelY - 12, textWidth + 8, 18);
          ctx.fillStyle = "#fff";
          ctx.font = "bold 11px Inter, sans-serif";
          ctx.fillText(dateText, labelX, labelY + 2);
        }
      }

      // Línea horizontal del crosshair + precio en el eje Y
      // 🎯 MODIFICADO: Mostrar precio siempre que esté en el área del gráfico
      if (mouseY >= marginTop && mouseY <= marginTop + priceChartHeight) {
        // Calcular precio basado en la posición exacta del mouse
        const price = minPrice + ((marginTop + priceChartHeight - mouseY + verticalOffset) / yScale);

        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2; // Más grueso para mejor visibilidad
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(marginLeft, mouseY);
        ctx.lineTo(width - marginRight, mouseY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Mostrar precio en el eje Y (derecha) - siempre visible
        ctx.fillStyle = "#333";
        ctx.fillRect(width - marginRight + 2, mouseY - 10, 58, 20);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 11px Inter, sans-serif";
        ctx.fillText(price.toFixed(2), width - marginRight + 6, mouseY + 4);
      }
    }
  };

  // ==================== DATA LOADING ====================
  
  const loadHistoricalData = async () => {
    try {
      const timestamp = Date.now();

      // 🔄 CARGA INCREMENTAL: Verificar si hay cache disponible Y suficiente
      const hasSufficientCache = await CandleCache.hasSufficientData(symbol, interval, days);
      const cached = hasSufficientCache ? await CandleCache.get(symbol, interval) : null;
      let url;
      let isIncremental = false;

      if (cached && cached.candles.length > 0) {
        // Tenemos cache suficiente - pedir solo velas nuevas desde el último timestamp
        const sinceTs = cached.lastTimestamp;
        url = `${API_BASE_URL}/api/historical/${symbol}?interval=${interval}&since_timestamp=${sinceTs}&t=${timestamp}`;
        isIncremental = true;
        console.log(`[${symbol}] 🔄 Carga INCREMENTAL: desde ${new Date(sinceTs).toLocaleString()} (${cached.candles.length} velas en cache)`);
      } else {
        // No hay cache o es insuficiente - carga completa
        url = `${API_BASE_URL}/api/historical/${symbol}?interval=${interval}&days=${days}&t=${timestamp}`;
        console.log(`[${symbol}] 📥 Carga COMPLETA: ${days} días @ ${interval}`);
      }

      const res = await fetch(url, {
        cache: 'no-cache',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      const json = await res.json();

      if (json.success && json.data) {
        let newCandles = json.data;

        // Filtrar vela en progreso
        const now = Date.now();
        const intervalMs = getIntervalMilliseconds(interval);
        const currentTimeframeStart = Math.floor(now / intervalMs) * intervalMs;

        if (newCandles.length > 0) {
          const lastCandle = newCandles[newCandles.length - 1];
          if (lastCandle.timestamp >= currentTimeframeStart) {
            log.debug(`[${symbol}] ⚠️ Removiendo vela en progreso`);
            newCandles = newCandles.slice(0, -1);
          }
        }

        // Merge con cache si es carga incremental
        let finalCandles;
        // Resetear zoom si: carga completa O primera carga con cache (zoom está en default)
        const isFirstLoad = viewStateRef.current.zoom === 1 && candlesRef.current.length === 0;
        let shouldResetZoom = isFirstLoad;

        if (isIncremental && cached) {
          // Merge: cache + nuevas velas
          finalCandles = CandleCache.merge(cached.candles, newCandles);
          console.log(`[${symbol}] ✅ Incremental: +${newCandles.length} velas nuevas = ${finalCandles.length} total`);
        } else {
          // Carga completa - usar todas las velas
          finalCandles = newCandles;
          shouldResetZoom = true;
          console.log(`[${symbol}] ✅ Completa: ${finalCandles.length} velas`);
        }

        // Preservar velas del WebSocket que son más nuevas
        const existingCandles = candlesRef.current;
        if (existingCandles && existingCandles.length > 0 && finalCandles.length > 0) {
          const lastFinalTs = finalCandles[finalCandles.length - 1].timestamp;
          const newerFromWs = existingCandles.filter(c => c.timestamp > lastFinalTs);
          if (newerFromWs.length > 0) {
            finalCandles = [...finalCandles, ...newerFromWs];
          }
        }

        // Actualizar ref y cache
        candlesRef.current = finalCandles;

        // Guardar en cache (async, no blocking)
        CandleCache.set(symbol, interval, finalCandles);

        console.log(`[${symbol}] ✅ Histórico final: ${candlesRef.current.length} velas`);

        // ✅ NUEVO: Notificar a IndicatorManager que las velas están disponibles
        // Esto permite que DBT pueda hacer análisis completo inicial
        if (indicatorManagerRef.current) {
          indicatorManagerRef.current.onHistoricalCandlesLoaded(finalCandles);
        }

        // 🎯 Solo resetear escala y zoom cuando hay cambios significativos (carga inicial o más velas)
        if (shouldResetZoom) {
          // Resetear escala de precios para recalcular con nuevos datos
          priceScaleRef.current.minPrice = null;
          priceScaleRef.current.maxPrice = null;

          // Ajustar zoom inicial para mostrar el número deseado de velas
          // Minichart: ~800 velas (máximo contexto)
          // Fullscreen: ~1500 velas
          if (canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect();
            const chartWidth = rect.width - 75; // Restar márgenes

            // Determinar número de velas deseado según tamaño del canvas
            // Si width > 1000px, es fullscreen, de lo contrario es minichart
            // Más velas = menos zoom = más contexto histórico visible
            const targetCandles = chartWidth > 1000 ? 1500 : 800;

            // Calcular zoom necesario para mostrar ese número de velas
            // barWidth = 8 * zoom, candlesPerScreen = chartWidth / barWidth
            // targetCandles = chartWidth / (8 * zoom)
            // zoom = chartWidth / (targetCandles * 8)
            const calculatedZoom = chartWidth / (targetCandles * 8);
            viewStateRef.current.zoom = Math.max(0.1, Math.min(5, calculatedZoom));

            log.debug(`[${symbol}] 🎯 Zoom inicial ajustado: ${viewStateRef.current.zoom.toFixed(2)} para mostrar ~${targetCandles} velas`);
          }
        }

        // ✅ NUEVO: Verificar si hay gap después de cargar
        if (indicatorManagerRef.current) {
          setTimeout(() => {
            indicatorManagerRef.current.checkAndRefreshIfNeeded(candlesRef.current);
          }, 1000);
        }

        // 🎯 NUEVO: Analizar rangos de consolidación
        if (indicatorManagerRef.current && indicatorManagerRef.current.isRangeDetectionEnabled()) {
          log.debug(`[${symbol}] 🔍 Range Detection habilitado - programando análisis en 1.5s`);
          setTimeout(() => {
            log.debug(`[${symbol}] 🚀 Ejecutando analyzeRanges() con ${candlesRef.current.length} velas`);
            indicatorManagerRef.current.analyzeRanges(candlesRef.current);
          }, 1500);
        } else {
          log.debug(`[${symbol}] ⏸️ Range Detection NO habilitado o indicatorManager no existe`);
        }

        // 🎯 VIRTUALIZACIÓN: Marcar como inicializado después de la primera carga exitosa
        setIsInitialized(true);

        drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);

        // ⏱️ CRONÓMETRO: Notificar al padre después de que los indicadores hayan tenido tiempo de cargar
        // Los indicadores (VWAP, Swing) hacen fetch asíncrono, esperamos a que terminen
        if (onChartLoaded && indicatorManagerRef.current) {
          // Esperar a que el IndicatorManager refresque los indicadores
          indicatorManagerRef.current.refresh().then(() => {
            onChartLoaded();
          }).catch(() => {
            // Si falla el refresh, notificar de todas formas
            onChartLoaded();
          });
        } else if (onChartLoaded) {
          onChartLoaded();
        }
      } else {
        console.error(`[${symbol}] Error en respuesta histórica`, json);
      }
    } catch (err) {
      console.error(`[${symbol}] Error cargando histórico`, err);
    }
  };

  // ==================== WEBSOCKET HANDLER ====================

  // 🎯 VIRTUALIZACIÓN: Ref para el handler (usada para pause/resume)
  const wsHandlerRef = useRef(null);

  const handleWebSocketMessage = (data) => {
    if (!mountedRef.current) return;

    // Si el RenderManager existe, usarlo para optimización
    if (renderManagerRef.current) {
      renderManagerRef.current.handleWebSocketUpdate(data, {
        onPriceUpdate: (updateData) => {
          // Actualización de precio (alta frecuencia)
          if (updateData && updateData.topic && updateData.topic.startsWith("tickers.")) {
            const tickerData = updateData.data;
            if (tickerData && tickerData.lastPrice) {
              const newPrice = parseFloat(tickerData.lastPrice);
              lastPriceRef.current = newPrice;

              if (!animationFrameRef.current) {
                animationFrameRef.current = requestAnimationFrame(() => {
                  drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
                  animationFrameRef.current = null;
                });
              }
            }
          }
        },
        onIndicatorUpdate: (updateData) => {
          // Actualización de indicadores (solo al cerrar velas)
          log.debug(`[${symbol}] 🕐 Vela cerrada - actualizando indicadores`);

          if (indicatorManagerRef.current) {
            // Actualizar indicadores con nuevos datos
            indicatorManagerRef.current.checkAndRefreshIfNeeded(candlesRef.current);

            // Analizar rangos si está habilitado
            if (indicatorManagerRef.current.isRangeDetectionEnabled()) {
              log.debug(`[${symbol}] 🔄 Analizando rangos tras cierre de vela`);
              indicatorManagerRef.current.analyzeRanges(candlesRef.current);
            }

            // ✅ FIX: Notificar cierre de vela para alertas en tiempo real (DTB, etc.)
            if (indicatorManagerRef.current.onCandleClose) {
              indicatorManagerRef.current.onCandleClose(candlesRef.current);
            }
          }

          // Redibujar con indicadores actualizados
          if (!animationFrameRef.current) {
            animationFrameRef.current = requestAnimationFrame(() => {
              drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
              animationFrameRef.current = null;
            });
          }
        }
      });
    }

    // IMPORTANTE: Procesar datos de ticker para precio actual
    if (data.topic && data.topic.startsWith("tickers.")) {
      const tickerData = data.data;
      if (tickerData && tickerData.lastPrice) {
        const newPrice = parseFloat(tickerData.lastPrice);
        lastPriceRef.current = newPrice;

        // Si no hay RenderManager, actualizar siempre
        if (!renderManagerRef.current && !animationFrameRef.current) {
          animationFrameRef.current = requestAnimationFrame(() => {
            drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
            animationFrameRef.current = null;
          });
        }
      }
    }

    // Procesar datos de velas (mantener lógica existente SIEMPRE)
    if (data.topic && data.topic.startsWith("kline.")) {
      const klineData = data.data;
      if (klineData && klineData.length > 0) {
        const candle = klineData[0];
        const candleTimestamp = parseInt(candle.start);
        const datetime_colombia = formatDateTimeColombia(candleTimestamp);

        const newCandle = {
          timestamp: candleTimestamp,
          open: parseFloat(candle.open),
          high: parseFloat(candle.high),
          low: parseFloat(candle.low),
          close: parseFloat(candle.close),
          volume: parseFloat(candle.volume),
          datetime_colombia: datetime_colombia,
          in_progress: !candle.confirm
        };

        const currentInProgress = inProgressCandleRef.current;

        if (!currentInProgress) {
          inProgressCandleRef.current = newCandle;
          // Performance: Disabled frequent logging
          // log.debug(`[${symbol}] 🆕 Primera vela en progreso`, { timestamp: candleTimestamp, datetime: datetime_colombia });

        } else if (candleTimestamp > currentInProgress.timestamp) {
          candlesRef.current.push(currentInProgress);

          if (candlesRef.current.length > 2000) {
            candlesRef.current.shift();
          }

          inProgressCandleRef.current = newCandle;
          // Performance: Disabled frequent logging
          // log.trace(`[${symbol}] Estado: ${candlesRef.current.length} confirmadas, En progreso: ${true ? 'SÍ' : 'NO'}`);

          // 🔄 FASE 5: Sincronizar caches cuando se cierra una vela
          // 1. Actualizar cache de velas con la nueva vela cerrada
          CandleCache.set(symbol, interval, candlesRef.current);
          // 2. Invalidar cache de indicadores (necesitan recalcularse)
          IndicatorCache.invalidate(symbol, interval);

          // ✅ REAL-TIME DETECTION: Notificar al IndicatorManager cuando se cierra una vela
          // Usa referencia directa (sin spread operator) para evitar copia de 2000+ objetos
          // El IndicatorManager tiene throttling interno (90% del intervalo) para prevenir exceso de detecciones
          if (indicatorManagerRef.current && indicatorManagerRef.current.onCandleClose) {
            indicatorManagerRef.current.onCandleClose(candlesRef.current);
          }

        } else if (candleTimestamp === currentInProgress.timestamp) {
          inProgressCandleRef.current = newCandle;
        }

        if (!animationFrameRef.current) {
          animationFrameRef.current = requestAnimationFrame(() => {
            drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
            animationFrameRef.current = null;
          });
        }
      }
    }
  };

  // ==================== MOUSE HANDLERS ====================

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 📏 Actualizar MeasurementTool si está midiendo (sin throttle para precisión)
    if (drawingMode && measurementToolRef.current && measurementToolRef.current.isMeasuring) {
      measurementToolRef.current.handleMouseMove(e, canvas);
      setMousePos({ x, y });
      drawChart(candlesRef.current, lastPriceRef.current, x, y);
      return;
    }

    // 🎨 Modo dibujo: delegar al DrawingToolManager (sin throttle para precisión)
    if (drawingMode && drawingManagerRef.current && scaleConverterRef.current) {
      const consumed = drawingManagerRef.current.handleMouseMove(x, y, scaleConverterRef.current);

      // Cambiar cursor según el estado
      if (selectedDrawingTool === 'select') {
        const selectedShape = drawingManagerRef.current.selectedShape;
        if (selectedShape && (selectedShape.isDragging || selectedShape.isResizing)) {
          canvas.style.cursor = 'grabbing';
        } else if (drawingManagerRef.current.hoveredShape) {
          canvas.style.cursor = 'grab';
        } else {
          canvas.style.cursor = 'crosshair';
        }
      } else {
        canvas.style.cursor = 'crosshair';
      }

      if (consumed) {
        setMousePos({ x, y });
        drawChart(candlesRef.current, lastPriceRef.current, x, y);
        return;
      }
    }

    // Dragging requiere respuesta inmediata (sin throttle)
    if (dragStateRef.current.isDragging) {
      // 🎯 Paneo horizontal
      const deltaX = x - dragStateRef.current.startX;
      const chartWidth = rect.width - 75;
      const candlesPerScreen = Math.floor(chartWidth / (8 * viewStateRef.current.zoom));
      const deltaCandlesFloat = (deltaX / chartWidth) * candlesPerScreen;
      const deltaCandles = Math.round(deltaCandlesFloat);

      const maxOffset = Math.max(0, candlesRef.current.length - candlesPerScreen);
      const newOffset = Math.max(0, Math.min(maxOffset, dragStateRef.current.startOffset + deltaCandles));
      viewStateRef.current.offset = newOffset;

      // 🎯 NUEVO: Paneo vertical
      const deltaY = y - dragStateRef.current.startY;
      const newVerticalOffset = dragStateRef.current.startVerticalOffset + deltaY;
      viewStateRef.current.verticalOffset = newVerticalOffset;

      drawChart(candlesRef.current, lastPriceRef.current, null, null);
    } else {
      // 🚀 OPTIMIZACIÓN: Throttle para crosshair/hover - máximo ~30 FPS
      // Esto reduce CPU significativamente cuando el mouse se mueve sobre el chart
      const now = performance.now();
      const THROTTLE_MS = 33; // ~30 FPS para crosshair (era ilimitado antes)

      if (now - lastMouseMoveRef.current >= THROTTLE_MS) {
        lastMouseMoveRef.current = now;
        setMousePos({ x, y });

        // Cancelar RAF pendiente si existe
        if (pendingMouseMoveRef.current) {
          cancelAnimationFrame(pendingMouseMoveRef.current);
        }

        pendingMouseMoveRef.current = requestAnimationFrame(() => {
          drawChart(candlesRef.current, lastPriceRef.current, x, y);
          pendingMouseMoveRef.current = null;
        });
      }
    }
  };

  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 📏 Middle-click (button === 1) - Herramienta de medición
    if (e.button === 1 && drawingMode && measurementToolRef.current) {
      e.preventDefault();
      e.stopPropagation();
      measurementToolRef.current.handleMouseDown(e, canvas);
      drawChart(candlesRef.current, lastPriceRef.current, x, y);
      return;
    }

    // 🎨 Modo dibujo: delegar al DrawingToolManager (solo left-click)
    if (e.button === 0 && drawingMode && drawingManagerRef.current && scaleConverterRef.current) {
      // 📝 Detectar doble-click en TextBox para editar
      const clickedShape = drawingManagerRef.current.findShapeAt(x, y, scaleConverterRef.current);
      if (clickedShape && clickedShape.type === 'textbox') {
        const now = Date.now();
        const timeSinceLastClick = now - lastTextBoxClickTimeRef.current;
        const isSameTextBox = lastTextBoxClickedIdRef.current === clickedShape.id;

        if (timeSinceLastClick < 300 && isSameTextBox) {
          // Doble-click detectado - abrir modal de edición
          e.preventDefault();
          e.stopPropagation();
          setTextBoxBeingEdited(clickedShape);
          setIsTextEditModalOpen(true);
          lastTextBoxClickTimeRef.current = 0;
          lastTextBoxClickedIdRef.current = null;
          return;
        }

        lastTextBoxClickTimeRef.current = now;
        lastTextBoxClickedIdRef.current = clickedShape.id;
      }

      const consumed = drawingManagerRef.current.handleMouseDown(
        x, y, scaleConverterRef.current, selectedDrawingTool
      );

      if (consumed) {
        // 📝 Si se creó un TextBox nuevo, abrir modal inmediatamente
        if (selectedDrawingTool === 'textbox') {
          const shapes = drawingManagerRef.current.shapes;
          const newTextBox = shapes[shapes.length - 1];
          if (newTextBox && newTextBox.type === 'textbox') {
            setTextBoxBeingEdited(newTextBox);
            setIsTextEditModalOpen(true);
          }
        }
        drawChart(candlesRef.current, lastPriceRef.current, x, y);
        return;
      }

      // Si estamos en modo select y no se consumió el click, permitir panning
      if (selectedDrawingTool === 'select') {
        dragStateRef.current = {
          isDragging: true,
          startX: x,
          startY: y,
          startOffset: viewStateRef.current.offset,
          startVerticalOffset: viewStateRef.current.verticalOffset || 0
        };
        canvas.style.cursor = 'grabbing';
      }
      return;
    }

    // Panning normal (fuera de modo dibujo)
    if (e.button === 0) {
      dragStateRef.current = {
        isDragging: true,
        startX: x,
        startY: y,
        startOffset: viewStateRef.current.offset,
        startVerticalOffset: viewStateRef.current.verticalOffset || 0
      };
      canvas.style.cursor = 'grabbing';
    }
  };

  const handleMouseUp = () => {
    // 🎨 Modo dibujo: delegar al DrawingToolManager
    if (drawingMode && drawingManagerRef.current && scaleConverterRef.current) {
      // Verificar si hay un shape siendo arrastrado/redimensionado
      const wasModifying = drawingManagerRef.current.selectedShape &&
        (drawingManagerRef.current.selectedShape.isDragging ||
         drawingManagerRef.current.selectedShape.isResizing);

      drawingManagerRef.current.handleMouseUp(scaleConverterRef.current);

      // Si se estaba modificando un shape, guardar al servidor
      if (wasModifying) {
        saveDrawingsInline();
      }
    }

    dragStateRef.current.isDragging = false;
    if (canvasRef.current) {
      canvasRef.current.style.cursor = drawingMode ? 'crosshair' : 'crosshair';
    }
  };

  const handleMouseLeave = () => {
    dragStateRef.current.isDragging = false;
    setMousePos(null);
    // Solo redibujar si NO estamos en modo dibujo (evita parpadeo al ir al toolbar)
    if (!drawingMode) {
      drawChart(candlesRef.current, lastPriceRef.current, null, null);
    }
    if (canvasRef.current) {
      canvasRef.current.style.cursor = 'crosshair';
    }
  };

  const handleWheel = (e) => {
    // 🎯 BLOQUEADO: No permitir zoom mientras se está haciendo paneo (arrastrando)
    if (dragStateRef.current.isDragging) {
      return;
    }

    // 🎯 NUEVO: Ctrl + rueda = zoom vertical (escala de precios) centrado en el mouse
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault(); // Prevenir zoom del navegador

      const canvas = canvasRef.current;
      if (!canvas || !candlesRef.current || candlesRef.current.length === 0) return;

      const rect = canvas.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);

      // 🎯 IMPORTANTE: Usar las MISMAS dimensiones que drawChart
      const marginTop = 25;
      const timeAxisHeight = 25;
      const baseVolumeHeight = 50;
      const minPriceChartHeight = 180;

      // Calcular altura de indicadores
      let desiredIndicatorsHeight = 0;
      if (indicatorManagerRef.current) {
        desiredIndicatorsHeight = indicatorManagerRef.current.getTotalHeight();
      }

      const availableHeight = height - marginTop - timeAxisHeight;
      const totalNeeded = minPriceChartHeight + baseVolumeHeight + desiredIndicatorsHeight;

      let priceChartHeight, volumeHeight, indicatorsHeight;

      if (availableHeight >= totalNeeded) {
        volumeHeight = baseVolumeHeight;
        indicatorsHeight = desiredIndicatorsHeight;
        priceChartHeight = availableHeight - volumeHeight - indicatorsHeight;
      } else {
        const scale = availableHeight / totalNeeded;
        priceChartHeight = Math.floor(minPriceChartHeight * scale);
        volumeHeight = Math.floor(baseVolumeHeight * scale);
        indicatorsHeight = Math.floor(desiredIndicatorsHeight * scale);

        const actualTotal = priceChartHeight + volumeHeight + indicatorsHeight;
        const diff = availableHeight - actualTotal;
        if (diff > 0) {
          priceChartHeight += diff;
        }
      }

      // Verificar que el mouse está en el área del gráfico de precios
      if (mouseY < marginTop || mouseY > (marginTop + priceChartHeight)) {
        return; // No hacer zoom si el mouse está fuera del área de precios
      }

      // 🎯 IMPORTANTE: Usar displayCandles como en drawChart (incluye inProgressCandle)
      let displayCandles = [...candlesRef.current];
      if (inProgressCandleRef.current) {
        displayCandles.push(inProgressCandleRef.current);
      }

      displayCandles = displayCandles.filter(d =>
        d.open > 0 && d.high > 0 && d.low > 0 && d.close > 0 &&
        d.high >= d.low && d.high >= d.open && d.high >= d.close &&
        d.low <= d.open && d.low <= d.close
      );

      if (displayCandles.length === 0) return;

      // Calcular el precio en la posición del mouse ANTES del zoom
      const minPrice = Math.min(...displayCandles.map(d => d.low));
      const maxPrice = Math.max(...displayCandles.map(d => d.high));
      const priceRange = maxPrice - minPrice;

      const oldVerticalZoom = viewStateRef.current.verticalZoom || 1;
      const oldVerticalOffset = viewStateRef.current.verticalOffset || 0;
      const oldBaseYScale = priceRange > 0 ? priceChartHeight / priceRange : 1;
      const oldYScale = oldBaseYScale * oldVerticalZoom;

      // 🎯 Precio en la posición del mouse ANTES del zoom
      // Fórmula de drawChart: yCanvas = marginTop + priceChartHeight - (price - minPrice) * yScale + verticalOffset
      // Despejando price: price = minPrice + (marginTop + priceChartHeight - yCanvas + verticalOffset) / yScale
      const priceAtMouse = minPrice + (marginTop + priceChartHeight - mouseY + oldVerticalOffset) / oldYScale;

      // Aplicar nuevo zoom (aumentado a 6x para mejor visualización de patrones)
      const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
      const newVerticalZoom = Math.max(0.3, Math.min(6, oldVerticalZoom * zoomFactor));
      const newBaseYScale = priceRange > 0 ? priceChartHeight / priceRange : 1;
      const newYScale = newBaseYScale * newVerticalZoom;

      // 🎯 Calcular el nuevo offset para que el mismo precio quede en la misma posición Y
      // Queremos: mouseY = marginTop + priceChartHeight - (priceAtMouse - minPrice) * newYScale + newVerticalOffset
      // Despejando: newVerticalOffset = mouseY - marginTop - priceChartHeight + (priceAtMouse - minPrice) * newYScale
      const newVerticalOffset = mouseY - marginTop - priceChartHeight + (priceAtMouse - minPrice) * newYScale;

      viewStateRef.current.verticalZoom = newVerticalZoom;
      viewStateRef.current.verticalOffset = newVerticalOffset;

      drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
      return;
    }

    // Zoom horizontal normal (zoom in/out de velas)
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const oldZoom = viewStateRef.current.zoom;
    // Permitir más compresión (min 0.1) para ver más velas y más contexto
    const newZoom = Math.max(0.1, Math.min(5, oldZoom * zoomFactor));
    viewStateRef.current.zoom = newZoom;

    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const chartWidth = rect.width - 75;
      const candlesPerScreen = Math.floor(chartWidth / (8 * newZoom));
      const maxOffset = Math.max(0, candlesRef.current.length - candlesPerScreen);
      viewStateRef.current.offset = Math.min(viewStateRef.current.offset, maxOffset);
    }

    drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
  };

  const goToLatestCandle = () => {
    viewStateRef.current.offset = 0;
    drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
  };

  const goToFirstCandle = () => {
    // Calcular el offset máximo para mostrar la primera vela
    const canvas = canvasRef.current;
    if (!canvas || !candlesRef.current || candlesRef.current.length === 0) return;

    const chartWidth = canvas.width - 75; // 75 = priceScaleWidth
    const barWidth = Math.max(2, Math.min(20, 8 * viewStateRef.current.zoom));
    const candlesPerScreen = Math.floor(chartWidth / barWidth);
    const maxOffset = Math.max(0, candlesRef.current.length - candlesPerScreen);

    viewStateRef.current.offset = maxOffset;
    drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
  };

  const handleDoubleClick = (e) => {
    const canvas = canvasRef.current;

    // 🛡️ Debounce: ignorar doble-clicks que ocurran en menos de 300ms
    const now = Date.now();
    if (now - lastDoubleClickRef.current < 300) {
      console.log(`[${symbol}] 🖱️ handleDoubleClick IGNORADO por debounce (${now - lastDoubleClickRef.current}ms)`);
      return;
    }
    lastDoubleClickRef.current = now;

    console.log(`[${symbol}] 🖱️ handleDoubleClick llamado, shiftKey=${e.shiftKey}, drawingMode=${drawingMode}`);

    // Shift+DblClick: comportamiento legacy (abre ChartModal)
    if (e.shiftKey) {
      console.log(`[${symbol}] 🖱️ Shift+DblClick -> abriendo ChartModal`);
      setShowChartModal(true);
      return;
    }

    if (!canvas || !candlesRef.current || candlesRef.current.length === 0) {
      // Si no hay canvas o datos, solo abrir ChartModal
      console.log(`[${symbol}] 🖱️ Sin canvas/datos -> abriendo ChartModal`);
      setShowChartModal(true);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const width = rect.width;
    const height = rect.height;
    const marginRight = 65;
    const marginTop = 30;
    const timeAxisHeight = 25;
    const volumeHeight = 60;

    const priceChartHeight = height - marginTop - volumeHeight - timeAxisHeight - 20;

    // 🎯 Verificar si el doble click fue en el área del eje de precios (derecha)
    const isInPriceAxis = x >= (width - marginRight) && x <= width;
    const isInPriceChartArea = y >= marginTop && y <= (marginTop + priceChartHeight);

    console.log(`[${symbol}] 🖱️ x=${x.toFixed(0)}, width=${width.toFixed(0)}, isInPriceAxis=${isInPriceAxis}, isInPriceChartArea=${isInPriceChartArea}`);

    if (isInPriceAxis && isInPriceChartArea) {
      // 🎯 Auto-scale vertical: resetear zoom y offset para llenar la ventana
      console.log(`[${symbol}] 🖱️ Auto-scale activado`);
      viewStateRef.current.verticalZoom = 1;
      viewStateRef.current.verticalOffset = 0;

      drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
    } else {
      // 🎯 Doble click en área de gráfico: toggle modo dibujo inline
      console.log(`[${symbol}] 🖱️ Toggle drawingMode: ${drawingMode} -> ${!drawingMode}`);
      setDrawingMode(prev => !prev);
    }
  };

  // ==================== FIXED RANGE PROFILES ====================
  
  const handleCreateFixedRangeProfile = (startTimestamp, endTimestamp, applyToAll = false) => {
    if (indicatorManagerRef.current) {
      const rangeId = indicatorManagerRef.current.createFixedRangeProfile(startTimestamp, endTimestamp);
      const profiles = indicatorManagerRef.current.getFixedRangeProfiles();
      setFixedRangeProfiles(profiles);

      // ✅ NUEVO: Si applyToAll es true, guardar en localStorage global
      if (applyToAll) {
        const globalRanges = JSON.parse(localStorage.getItem('vp_fixed_ranges_global') || '[]');
        const newRange = {
          startTimestamp,
          endTimestamp,
          id: `global_${Date.now()}`,
          createdAt: Date.now()
        };
        globalRanges.push(newRange);
        localStorage.setItem('vp_fixed_ranges_global', JSON.stringify(globalRanges));
        log.debug(`✅ Fixed Range guardado globalmente para todas las monedas:`, newRange);

        // Forzar actualización en todos los componentes (esto se hace a través de un refresh global)
        window.dispatchEvent(new CustomEvent('globalFixedRangeCreated', { detail: newRange }));
      }

      // ✅ FIX: Resetear escala vertical cuando se crea un VP para evitar desplazamientos
      viewStateRef.current.verticalZoom = 1;
      viewStateRef.current.verticalOffset = 0;

      indicatorManagerRef.current.saveFixedRangeProfilesToStorage();
      drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
    }
  };

  const handleDeleteFixedRangeProfile = (rangeId) => {
    if (indicatorManagerRef.current) {
      indicatorManagerRef.current.deleteFixedRangeProfile(rangeId);
      const profiles = indicatorManagerRef.current.getFixedRangeProfiles();
      setFixedRangeProfiles(profiles);
      indicatorManagerRef.current.saveFixedRangeProfilesToStorage();
      drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
    }
  };

  // ✅ NUEVO: Handler para borrar todos los Fixed Range Profiles
  const handleDeleteAllFixedRangeProfiles = () => {
    if (indicatorManagerRef.current) {
      const count = indicatorManagerRef.current.deleteAllFixedRangeProfiles();
      setFixedRangeProfiles([]); // Limpiar estado
      drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
      log.debug(`✅ ${count} Fixed Range Profiles eliminados para ${symbol}`);
    }
  };

  // ✅ NUEVO: Handler para borrar todos los VP Fixed Ranges en TODAS las monedas
  const handleDeleteAllFixedRangeProfilesGlobal = () => {
    // Limpiar localStorage global
    localStorage.removeItem('vp_fixed_ranges_global');

    // Limpiar en este símbolo
    if (indicatorManagerRef.current) {
      indicatorManagerRef.current.deleteAllFixedRangeProfiles();
      setFixedRangeProfiles([]);
    }

    // Notificar a todos los componentes para que limpien sus VP
    window.dispatchEvent(new CustomEvent('globalFixedRangesDeleted'));

    drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
    log.debug(`✅ Todos los VP Fixed Ranges eliminados GLOBALMENTE`);
  };

  const handleToggleFixedRangeProfile = (rangeId, enabled) => {
    if (indicatorManagerRef.current) {
      indicatorManagerRef.current.toggleFixedRangeProfile(rangeId, enabled);
      const profiles = indicatorManagerRef.current.getFixedRangeProfiles();
      setFixedRangeProfiles(profiles);
      indicatorManagerRef.current.saveFixedRangeProfilesToStorage();
      drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
    }
  };

  const handleConfigureFixedRangeProfile = (rangeId) => {
    if (indicatorManagerRef.current) {
      const profile = indicatorManagerRef.current.fixedRangeProfiles.find(p => p.rangeId === rangeId);
      if (profile) {
        const config = {
          rows: profile.rows,
          valueAreaPercent: profile.valueAreaPercent,
          histogramMaxWidth: profile.histogramMaxWidth,
          useGradient: profile.useGradient,
          baseColor: profile.baseColor,
          valueAreaColor: profile.valueAreaColor,
          pocColor: profile.pocColor,
          vahValColor: profile.vahValColor,
          rangeShadeColor: profile.rangeShadeColor,
          enableClusterDetection: profile.enableClusterDetection,
          clusterThreshold: profile.clusterThreshold,
          clusterColor: profile.clusterColor
        };
        
        setCurrentProfileConfig(config);
        setConfiguringProfileId(rangeId);
      }
    }
  };

  const handleApplyFixedProfileConfig = (profileId, config) => {
    if (indicatorManagerRef.current) {
      indicatorManagerRef.current.updateFixedRangeConfig(profileId, config);
      indicatorManagerRef.current.saveFixedRangeProfilesToStorage();
      drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
    }
  };

  // ==================== EFFECTS ====================
  
  useEffect(() => {
    if (indicatorManagerRef.current && vpConfig) {
      indicatorManagerRef.current.applyConfig("Volume Profile", vpConfig);
      indicatorManagerRef.current.setIndicatorMode("Volume Profile", vpConfig.mode);
      drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
    }
  }, [vpConfig]);

  useEffect(() => {
    if (indicatorManagerRef.current && indicatorManagerRef.current.days !== parseInt(days)) {
      log.debug(`[${symbol}] 📊 Días cambiados de ${indicatorManagerRef.current.days} a ${days}`);

      // ✅ NUEVO: Limpiar rangos auto-detectados cuando cambia la selección de días
      indicatorManagerRef.current.clearAutoDetectedRanges();

      indicatorManagerRef.current.days = parseInt(days);
      indicatorManagerRef.current.refresh().then(() => {
        drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
      });
    }
  }, [days, symbol]);

  useEffect(() => {
    if (indicatorManagerRef.current && vpFixedRange) {
      if (vpFixedRange.applyToAll || vpFixedRange.symbol === symbol) {
        indicatorManagerRef.current.setFixedRange(
          "Volume Profile",
          vpFixedRange.start,
          vpFixedRange.end
        );
        drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
      }
    }
  }, [vpFixedRange, symbol]);

  // 📊 Efecto para actualizar modo de Open Interest cuando cambie
  useEffect(() => {
    if (indicatorManagerRef.current && oiMode) {
      indicatorManagerRef.current.applyConfig("Open Interest", { mode: oiMode });
      drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
    }
  }, [oiMode]);

  // ==================== MAIN EFFECT ====================
  
  useEffect(() => {
    mountedRef.current = true;

    console.log(`[${symbol}] 🚀 Componente montado, iniciando...`);

    // Inicializar RenderManager
    renderManagerRef.current = new RenderManager(symbol, interval);

    const initIndicators = async () => {
      // ✅ Si hay manager externo (fullscreen), usarlo directamente
      if (externalIndicatorManager) {
        log.debug(`[${symbol}] 🔗 Usando IndicatorManager externo (fullscreen)`);
        indicatorManagerRef.current = externalIndicatorManager;

        // Sincronizar estados de indicadores visuales
        const profiles = externalIndicatorManager.getFixedRangeProfiles();
        setFixedRangeProfiles(profiles);

        // Agregar requestRedraw si no existe
        if (!externalIndicatorManager.requestRedraw) {
          externalIndicatorManager.requestRedraw = () => {
            if (candlesRef.current && candlesRef.current.length > 0) {
              log.debug(`[${symbol}] 🔄 Redraw requested by indicator`);
              drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
            }
          };
        }

        log.debug(`[${symbol}] 📊 ✅ IndicatorManager externo conectado`);
        drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
        return; // NO crear nuevo manager
      }

      // ✅ Si no hay externo, crear nuevo (comportamiento normal)
      log.debug(`[${symbol}] 🔧 Creando nuevo IndicatorManager`);
      indicatorManagerRef.current = new IndicatorManager(symbol, interval, parseInt(days));
      await indicatorManagerRef.current.initialize(indicatorStates);

      // ✨ NUEVO: Agregar referencia a drawChart para que los indicadores puedan forzar redibujado
      indicatorManagerRef.current.requestRedraw = () => {
        if (candlesRef.current && candlesRef.current.length > 0) {
          log.debug(`[${symbol}] 🔄 Redraw requested by indicator`);
          drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
        }
      };

      // 📋 Registrar en el registro global
      IndicatorManagerRegistry.register(symbol, indicatorManagerRef.current);

      // 🎛️ Aplicar presets globales con overrides por símbolo
      log.debug(`[${symbol}] 🎛️ Aplicando presets efectivos (global + overrides)`);
      const indicatorsWithPresets = [
        "Rejection Patterns",
        "Support & Resistance",
        "VWAP",
        "Fibonacci",
        "Continuation Patterns",
        "Volume Profile",
        "Range Detection",
        "Open Interest"
      ];

      indicatorsWithPresets.forEach(indicatorName => {
        const effectiveConfig = PresetManager.getEffectiveConfig(indicatorName, symbol);
        if (effectiveConfig && Object.keys(effectiveConfig).length > 0) {
          indicatorManagerRef.current.applyConfig(indicatorName, effectiveConfig);
        }
      });

      if (indicatorStates) {
        Object.entries(indicatorStates).forEach(([name, enabled]) => {
          indicatorManagerRef.current.toggleIndicator(name, enabled);
        });
      }

      if (vpConfig) {
        indicatorManagerRef.current.applyConfig("Volume Profile", vpConfig);
        indicatorManagerRef.current.setIndicatorMode("Volume Profile", vpConfig.mode);
      }

      // 📊 Configurar modo de Open Interest
      if (oiMode && indicatorManagerRef.current) {
        indicatorManagerRef.current.applyConfig("Open Interest", { mode: oiMode });
      }

      if (indicatorManagerRef.current) {
        const profiles = indicatorManagerRef.current.getFixedRangeProfiles();
        setFixedRangeProfiles(profiles);
        log.debug(`[${symbol}] ✅ Sincronizados ${profiles.length} Fixed Range Profiles`);

        // ✅ NUEVO: Cargar rangos globales (aplicados a todas las monedas)
        const globalRanges = JSON.parse(localStorage.getItem('vp_fixed_ranges_global') || '[]');
        if (globalRanges.length > 0) {
          log.debug(`[${symbol}] 📂 Cargando ${globalRanges.length} rangos globales`);
          globalRanges.forEach(range => {
            const existingProfile = profiles.find(p =>
              p.startTimestamp === range.startTimestamp && p.endTimestamp === range.endTimestamp
            );
            if (!existingProfile) {
              indicatorManagerRef.current.createFixedRangeProfile(range.startTimestamp, range.endTimestamp);
            }
          });
          // Actualizar lista después de crear
          const updatedProfiles = indicatorManagerRef.current.getFixedRangeProfiles();
          setFixedRangeProfiles(updatedProfiles);

          // ✅ FIX: Resetear escala vertical al cargar rangos globales
          viewStateRef.current.verticalZoom = 1;
          viewStateRef.current.verticalOffset = 0;
        }
      }
      log.debug(`[${symbol}] 📊 ✅ Indicadores inicializados`);
      drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
    };
    
    loadHistoricalData();
    // ✅ FIX: loadDrawings() movido a useEffect separado para evitar parpadeo
    // cuando cambian indicatorStates (no necesita recargar dibujos)
    initIndicators();

    const bybitInterval = getBybitInterval(interval);
    wsManager.connect(bybitInterval);

    // 🎯 VIRTUALIZACIÓN: Guardar handler en ref y marcar como suscrito
    wsHandlerRef.current = handleWebSocketMessage;
    wsManager.subscribe(symbol, handleWebSocketMessage);
    wsSubscribedRef.current = true;

    log.debug(`[${symbol}] 📡 Suscrito a WebSocket @ ${bybitInterval}`);

    // ✅ REDUCIDO: Recarga cada 5 minutos (el auto-refresh de indicadores se hace cada 1 min)
    const reloadInterval = setInterval(() => {
      log.debug(`[${symbol}] 🔄 Recarga periódica histórico (5 min)`);
      loadHistoricalData();
    }, 300000);

    // ✅ DESHABILITADO: gapCheckIntervalRef - checkAndRefreshIfNeeded ya no hace nada
    // El backend maneja los datos en tiempo real via WebSocket
    // gapCheckIntervalRef.current = setInterval(() => {
    //   if (indicatorManagerRef.current && candlesRef.current.length > 0) {
    //     indicatorManagerRef.current.checkAndRefreshIfNeeded(candlesRef.current);
    //   }
    // }, 30000);

    // ✅ DESHABILITADO: patternDetectionInterval - El backend detecta patrones en tiempo real
    // via WebSocket (realtime_pattern_service.py). No necesitamos polling desde el frontend.
    // const patternDetectionInterval = setInterval(async () => {
    //   if (indicatorManagerRef.current && rejectionPatternConfig) {
    //     log.debug(`[${symbol}] 📊 🔍 Ejecutando detección de patrones de rechazo...`);
    //     try {
    //       const patterns = await indicatorManagerRef.current.detectRejectionPatterns();
    //       if (patterns && patterns.length > 0) {
    //         log.debug(`[${symbol}] 📊 ✅ Detectados ${patterns.length} patrones`);
    //         drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
    //       }
    //     } catch (error) {
    //       log.error(`[${symbol}] Error en detección de patrones`, error);
    //     }
    //   }
    // }, 120000);

    const canvas = canvasRef.current;
    const preventScroll = (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleWheel(e);
    };

    if (canvas) {
      canvas.addEventListener('wheel', preventScroll, { passive: false });
      canvas.addEventListener('dblclick', handleDoubleClick);
    }

    return () => {
      // ✅ Solo limpiar si NO es manager externo
      if (!externalIndicatorManager) {
        log.debug(`[${symbol}] 🛑 Componente desmontado, limpiando...`);

        // 📋 Desregistrar del registro global
        IndicatorManagerRegistry.unregister(symbol);

        mountedRef.current = false;
        wsManager.unsubscribe(symbol, handleWebSocketMessage);

        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }

        // 🚀 Cancelar RAF de mousemove pendiente
        if (pendingMouseMoveRef.current) {
          cancelAnimationFrame(pendingMouseMoveRef.current);
        }

        clearInterval(reloadInterval);

        // ✅ DESHABILITADO: Ya no usamos estos intervalos
        // if (gapCheckIntervalRef.current) {
        //   clearInterval(gapCheckIntervalRef.current);
        // }
        // if (patternDetectionInterval) {
        //   clearInterval(patternDetectionInterval);
        // }

        // ✅ NUEVO: Destruir IndicatorManager correctamente (solo si no es externo)
        if (indicatorManagerRef.current) {
          indicatorManagerRef.current.destroy();
        }

        // Destruir RenderManager
        if (renderManagerRef.current) {
          renderManagerRef.current.destroy();
          renderManagerRef.current = null;
        }

        candlesRef.current = [];
        inProgressCandleRef.current = null;

        if (canvas) {
          canvas.removeEventListener('wheel', preventScroll);
          canvas.removeEventListener('dblclick', handleDoubleClick);
        }
      } else {
        log.debug(`[${symbol}] ⏭️ Skipping cleanup (external manager)`);
      }
    };
  }, [symbol, interval, days, indicatorStates, externalIndicatorManager]);

  // 🎨 FIX: Cargar dibujos SOLO cuando cambia el símbolo (evita parpadeo al toggle indicadores)
  // 🔄 SYNC: Polling cada 3s para detectar cambios desde otras apps (Analizador Cripto)
  useEffect(() => {
    // Carga inicial
    loadDrawings();

    // Polling para sincronizar con otras apps (solo cuando NO estamos en modo dibujo)
    const syncInterval = setInterval(() => {
      if (!drawingMode) {
        loadDrawings(true); // checkTimestampOnly = true
      }
    }, 3000);

    return () => clearInterval(syncInterval);
  }, [symbol, drawingMode]);

  // 🎯 VIRTUALIZACIÓN: Pausar/reanudar WebSocket según visibilidad
  const wsSubscribedRef = useRef(true); // Inicia como true porque el useEffect principal ya suscribe

  useEffect(() => {
    // No aplicar virtualización a fullscreen o managers externos
    if (isFullscreen || isFullscreenChild || externalIndicatorManager) return;
    // Necesitamos que el handler exista
    if (!wsHandlerRef.current) return;
    // No pausar hasta que se haya completado la inicialización
    if (!isInitialized) return;

    if (isVisible && !wsSubscribedRef.current) {
      // Chart visible - suscribir a WebSocket y recargar datos
      log.debug(`[${symbol}] 📡 Reactivando chart (visible) - recargando datos...`);
      wsManager.subscribe(symbol, wsHandlerRef.current);
      wsSubscribedRef.current = true;

      // Recargar datos históricos para rellenar gaps acumulados mientras estaba pausado
      loadHistoricalData();

      // Refrescar indicadores (VWAP, etc.) para que tengan datos actualizados
      if (indicatorManagerRef.current) {
        // 🚀 OPTIMIZACIÓN: Restaurar indicadores desde cache o refetch
        indicatorManagerRef.current.refresh();
      }
    } else if (!isVisible && wsSubscribedRef.current) {
      // Chart no visible - desuscribir de WebSocket para ahorrar recursos
      log.debug(`[${symbol}] 💤 Pausando WebSocket (no visible)`);
      wsManager.unsubscribe(symbol, wsHandlerRef.current);
      wsSubscribedRef.current = false;

      // 🚀 OPTIMIZACIÓN: Descargar datos de indicadores para liberar RAM
      // Los datos se guardan en IndicatorCache (IndexedDB) para restaurar después
      if (indicatorManagerRef.current) {
        indicatorManagerRef.current.unloadData();
      }
    }
  }, [isVisible, isInitialized, symbol, interval, isFullscreen, isFullscreenChild, externalIndicatorManager]);

  // ✅ NUEVO: Escuchar evento global para aplicar rangos a todas las monedas
  useEffect(() => {
    const handleGlobalRangeCreated = (event) => {
      const { startTimestamp, endTimestamp } = event.detail;
      if (indicatorManagerRef.current) {
        // Verificar si ya existe este rango
        const existingProfiles = indicatorManagerRef.current.getFixedRangeProfiles();
        const alreadyExists = existingProfiles.some(p =>
          p.startTimestamp === startTimestamp && p.endTimestamp === endTimestamp
        );

        if (!alreadyExists) {
          log.debug(`[${symbol}] 📥 Creando Fixed Range desde evento global`);
          indicatorManagerRef.current.createFixedRangeProfile(startTimestamp, endTimestamp);
          const updatedProfiles = indicatorManagerRef.current.getFixedRangeProfiles();
          setFixedRangeProfiles(updatedProfiles);

          // ✅ FIX: Resetear escala vertical al recibir un VP global
          viewStateRef.current.verticalZoom = 1;
          viewStateRef.current.verticalOffset = 0;

          indicatorManagerRef.current.saveFixedRangeProfilesToStorage();
          drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
        }
      }
    };

    // ✅ NUEVO: Handler para borrar todos los VP globalmente
    const handleGlobalRangesDeleted = () => {
      if (indicatorManagerRef.current) {
        log.debug(`[${symbol}] 🗑️ Eliminando todos los VP Fixed Ranges (evento global)`);
        indicatorManagerRef.current.deleteAllFixedRangeProfiles();
        setFixedRangeProfiles([]);
        drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
      }
    };

    window.addEventListener('globalFixedRangeCreated', handleGlobalRangeCreated);
    window.addEventListener('globalFixedRangesDeleted', handleGlobalRangesDeleted);

    return () => {
      window.removeEventListener('globalFixedRangeCreated', handleGlobalRangeCreated);
      window.removeEventListener('globalFixedRangesDeleted', handleGlobalRangesDeleted);
    };
  }, [symbol]);

  // ==================== RENDER ====================

  return (
    <>
      <div className="mini-chart" ref={containerRef}>
        {/* 🎯 VIRTUALIZACIÓN: Placeholder cuando el chart no es visible */}
        {!isVisible && !isFullscreen && !isFullscreenChild && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#1a1a2e',
            color: '#666',
            fontSize: '14px',
            zIndex: 50
          }}>
            <span>Chart pausado (fuera de pantalla)</span>
          </div>
        )}
        {/* 🎯 Contenedor para botones - ubicado a la derecha al lado del timeframe */}
        <div style={{
          position: 'absolute',
          top: '30px',
          right: '5px',
          display: 'flex',
          gap: '4px',
          zIndex: 100,
          flexWrap: 'wrap',
          maxWidth: '350px',
          justifyContent: 'flex-end'
        }}>
          <button
            className="fullscreen-btn"
            onClick={() => setIsFullscreen(true)}
            title="Pantalla completa"
            style={{
              background: '#2196F3',
              color: 'white',
              border: 'none',
              padding: '4px 8px',
              borderRadius: '3px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 'bold'
            }}
          >
            ⛶
          </button>
          <button
            className="goto-first-btn"
            onClick={goToFirstCandle}
            title="Ir a primera vela"
            style={{
              background: '#607D8B',
              color: 'white',
              border: 'none',
              padding: '4px 8px',
              borderRadius: '3px 0 0 3px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 'bold'
            }}
          >
            |←
          </button>
          <button
            className="goto-latest-btn"
            onClick={goToLatestCandle}
            title="Ir a ultima vela"
            style={{
              background: '#4CAF50',
              color: 'white',
              border: 'none',
              padding: '4px 8px',
              borderRadius: '0 3px 3px 0',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 'bold'
            }}
          >
            →|
          </button>
          {onOpenVpSettings && indicatorStates && indicatorStates["Volume Profile"] && (
            <button
              className="vp-chart-settings-btn"
              onClick={onOpenVpSettings}
              title="Configurar VP para esta moneda"
              style={{
                background: '#FF9800',
                color: 'white',
                border: 'none',
                padding: '4px 8px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 'bold'
              }}
            >
              VP
            </button>
          )}
          {onOpenRejectionPatternSettings && (
            <button
              className="rejection-pattern-settings-btn"
              onClick={() => onOpenRejectionPatternSettings(indicatorManagerRef.current)}
              title="Configurar Patrones de Rechazo"
              style={{
                background: '#4a9eff',
                color: 'white',
                border: 'none',
                padding: '4px 8px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 'bold',
                marginLeft: '4px'
              }}
            >
              📊 Patterns
            </button>
          )}
          {onOpenRangeDetectionSettings && (
            <button
              className="rd-chart-settings-btn"
              onClick={() => onOpenRangeDetectionSettings(indicatorManagerRef.current, candlesRef.current)}
              title="Configurar Range Detection"
              style={{
                background: '#9C27B0',
                color: 'white',
                border: 'none',
                padding: '4px 8px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 'bold',
                marginLeft: '4px'
              }}
            >
              🎯
            </button>
          )}
          {onOpenSupportResistanceSettings && (
            <button
              className="sr-chart-settings-btn"
              onClick={() => onOpenSupportResistanceSettings(indicatorManagerRef.current)}
              title="Configurar Support & Resistance"
              style={{
                background: '#FF9800',
                color: 'white',
                border: 'none',
                padding: '4px 8px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 'bold',
                marginLeft: '4px'
              }}
            >
              ⚡
            </button>
          )}
          {indicatorStates && indicatorStates["VWAP"] && (
            <button
              className="vwap-settings-btn"
              onClick={() => onOpenVWAPSettings(indicatorManagerRef.current)}
              title="Configurar VWAP"
              style={{
                background: '#FF9800',
                color: 'white',
                border: 'none',
                padding: '4px 10px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 'bold',
                marginLeft: '4px'
              }}
            >
              VW
            </button>
          )}
          {indicatorStates && indicatorStates["Fibonacci"] && (
            <button
              className="fibonacci-settings-btn"
              onClick={() => onOpenFibonacciSettings(indicatorManagerRef.current)}
              title="Configurar Fibonacci"
              style={{
                background: '#2196F3',
                color: 'white',
                border: 'none',
                padding: '4px 10px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 'bold',
                marginLeft: '4px'
              }}
            >
              FIB
            </button>
          )}
          {indicatorStates && indicatorStates["Continuation Patterns"] && (
            <button
              className="cp-settings-btn"
              onClick={() => onOpenContinuationPatternSettings(indicatorManagerRef.current)}
              title="Configurar Continuation Patterns"
              style={{
                background: '#4CAF50',
                color: 'white',
                border: 'none',
                padding: '4px 10px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 'bold',
                marginLeft: '4px'
              }}
            >
              CP
            </button>
          )}
          {indicatorStates && indicatorStates["Double Top/Bottom"] && (
            <>
              <button
                className="dtb-settings-btn"
                onClick={() => onOpenDoubleTopBottomSettings(indicatorManagerRef.current)}
                title="Configurar Double Top/Bottom"
                style={{
                  background: '#FF5722',
                  color: 'white',
                  border: 'none',
                  padding: '4px 10px',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  marginLeft: '4px'
                }}
              >
                DTB
              </button>
              <button
                className="dtb-alerts-history-btn"
                onClick={() => setShowAlertHistory(!showAlertHistory)}
                title="Ver historial de alertas DBT"
                style={{
                  background: '#2196F3',
                  color: 'white',
                  border: 'none',
                  padding: '4px 10px',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  marginLeft: '4px'
                }}
              >
                🔔
              </button>
            </>
          )}
          {indicatorStates && indicatorStates["Swing Detector"] && (
            <button
              className="swing-detector-settings-btn"
              onClick={() => onOpenSwingDetectorSettings(indicatorManagerRef.current)}
              title="Configurar Swing Detector"
              style={{
                background: '#00BCD4',
                color: 'white',
                border: 'none',
                padding: '4px 10px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 'bold',
                marginLeft: '4px'
              }}
            >
              SW
            </button>
          )}
          <button
            className="fixed-range-manager-btn"
            onClick={() => setShowFixedRangeManager(!showFixedRangeManager)}
            title="Gestionar VP Fixed Ranges"
            style={{
              background: '#607D8B',
              color: 'white',
              border: 'none',
              padding: '4px 8px',
              borderRadius: '3px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 'bold'
            }}
          >
            📊
          </button>
        </div>

        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onDoubleClick={handleDoubleClick}
          onAuxClick={(e) => {
            // Prevenir comportamiento por defecto del middle-click (auto-scroll)
            if (e.button === 1) {
              e.preventDefault();
            }
          }}
          onContextMenu={(e) => {
            // Prevenir menú contextual en modo dibujo
            if (drawingMode) {
              e.preventDefault();
            }
          }}
          style={{
            cursor: drawingMode ? 'crosshair' : 'crosshair',
            display: 'block',
            touchAction: 'none',
            outline: drawingMode ? '2px solid #3b82f6' : 'none'
          }}
        />
      </div>

      {/* FloatingToolbar para modo dibujo inline - mostrar en minichart normal o en hijo fullscreen */}
      {drawingMode && (!isFullscreen || isFullscreenChild) && (
        <FloatingToolbar
          selectedTool={selectedDrawingTool}
          onSelectTool={setSelectedDrawingTool}
          onClose={() => setDrawingMode(false)}
          onUndo={() => {
            if (drawingManagerRef.current) {
              drawingManagerRef.current.undo();
              saveDrawingsInline();
              drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
            }
          }}
          onRedo={() => {
            if (drawingManagerRef.current) {
              drawingManagerRef.current.redo();
              saveDrawingsInline();
              drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
            }
          }}
          onClearAll={() => {
            if (drawingManagerRef.current) {
              const shapesCount = drawingManagerRef.current.shapes?.length || 0;
              if (window.confirm(`¿Eliminar todos los dibujos? (${shapesCount} dibujos)`)) {
                drawingManagerRef.current.clearAll();
                // También limpiar drawingsRef para eliminar dibujos fantasma
                drawingsRef.current = [];
                saveDrawingsInline();
                drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
              }
            }
          }}
          compact={!isFullscreen}
          isFullscreen={isFullscreen}
          canvasRef={canvasRef}
        />
      )}

      {/* ColorPickerModal para cambiar color de líneas */}
      {isColorPickerOpen && shapeBeingColored && (
        <ColorPickerModal
          currentColor={shapeBeingColored.style?.color || '#3B82F6'}
          shapeName={
            shapeBeingColored.type === 'trendline' ? 'Línea de Tendencia' :
            shapeBeingColored.type === 'horizontal' ? 'Línea Horizontal' :
            shapeBeingColored.type === 'vertical' ? 'Línea Vertical' : 'Línea'
          }
          onSave={(newColor) => {
            if (shapeBeingColored && shapeBeingColored.style) {
              shapeBeingColored.style.color = newColor;
              if (drawingManagerRef.current) {
                drawingManagerRef.current.saveToHistory();
              }
              saveDrawingsInline();
              drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
            }
            setIsColorPickerOpen(false);
            setShapeBeingColored(null);
          }}
          onCancel={() => {
            setIsColorPickerOpen(false);
            setShapeBeingColored(null);
          }}
        />
      )}

      {/* TextEditModal para editar TextBox */}
      {isTextEditModalOpen && textBoxBeingEdited && (
        <TextEditModal
          initialText={textBoxBeingEdited.text}
          initialStyle={textBoxBeingEdited.style}
          onSave={(newText, newStyles) => {
            if (textBoxBeingEdited && newText.trim()) {
              textBoxBeingEdited.setText(newText);
              if (newStyles) {
                textBoxBeingEdited.style = { ...textBoxBeingEdited.style, ...newStyles };
              }
              if (drawingManagerRef.current) {
                drawingManagerRef.current.saveToHistory();
              }
              saveDrawingsInline();
              drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
              // Cambiar a modo select después de guardar
              setSelectedDrawingTool('select');
            } else if (textBoxBeingEdited && !newText.trim()) {
              // Si el texto está vacío, eliminar el TextBox
              if (drawingManagerRef.current) {
                const index = drawingManagerRef.current.shapes.indexOf(textBoxBeingEdited);
                if (index !== -1) {
                  drawingManagerRef.current.shapes.splice(index, 1);
                  drawingManagerRef.current.saveToHistory();
                  saveDrawingsInline();
                  drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
                }
              }
              setSelectedDrawingTool('select');
            }
            setIsTextEditModalOpen(false);
            setTextBoxBeingEdited(null);
          }}
          onCancel={() => {
            // Si era un TextBox nuevo con texto por defecto, eliminarlo
            if (textBoxBeingEdited &&
                (textBoxBeingEdited.text === 'Escribe aquí...' || textBoxBeingEdited.text === 'Texto...')) {
              if (drawingManagerRef.current) {
                const index = drawingManagerRef.current.shapes.indexOf(textBoxBeingEdited);
                if (index !== -1) {
                  drawingManagerRef.current.shapes.splice(index, 1);
                  drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
                }
              }
            }
            setSelectedDrawingTool('select');
            setIsTextEditModalOpen(false);
            setTextBoxBeingEdited(null);
          }}
        />
      )}

      {showFixedRangeManager && (
        <div className="modal-overlay" onClick={() => setShowFixedRangeManager(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button 
              className="modal-close-btn"
              onClick={() => setShowFixedRangeManager(false)}
              style={{ position: 'absolute', top: '10px', right: '10px' }}
            >
              ✕
            </button>
            <FixedRangeProfilesManager
              symbol={symbol}
              profiles={fixedRangeProfiles}
              onCreateProfile={handleCreateFixedRangeProfile}
              onDeleteProfile={handleDeleteFixedRangeProfile}
              onToggleProfile={handleToggleFixedRangeProfile}
              onConfigureProfile={handleConfigureFixedRangeProfile}
              onDeleteAllProfiles={handleDeleteAllFixedRangeProfiles}
              onDeleteAllProfilesGlobal={handleDeleteAllFixedRangeProfilesGlobal}
            />
          </div>
        </div>
      )}

      {showAlertHistory && (
        <AlertHistoryPanel
          symbol={symbol}
          interval={interval}
          onClose={() => setShowAlertHistory(false)}
        />
      )}

      {configuringProfileId && (
        <VolumeProfileFixedSettings 
          profileId={configuringProfileId}
          currentConfig={currentProfileConfig}
          onClose={() => {
            setConfiguringProfileId(null);
            setCurrentProfileConfig(null);
          }}
          onApply={handleApplyFixedProfileConfig}
        />
      )}

      {isFullscreen && (
        <div className="fullscreen-modal" onClick={() => setIsFullscreen(false)}>
          <div className="fullscreen-content" onClick={(e) => e.stopPropagation()}>
            <button
              className="close-fullscreen-btn"
              onClick={() => setIsFullscreen(false)}
            >
              ✕
            </button>

            {/* Selector de modo de Open Interest en fullscreen */}
            {indicatorStates["Open Interest"] && (
              <div style={{
                position: 'absolute',
                top: '15px',
                left: '15px',
                zIndex: 1000,
                background: 'white',
                padding: '8px 12px',
                borderRadius: '4px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#333' }}>
                  Open Interest Mode:
                </label>
                <select
                  value={fullscreenOiMode}
                  onChange={(e) => setFullscreenOiMode(e.target.value)}
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    border: '1px solid #ddd',
                    borderRadius: '3px',
                    cursor: 'pointer'
                  }}
                >
                  <option value="histogram">Histogram</option>
                  <option value="cumulative">Cumulative</option>
                  <option value="flow">Flow</option>
                </select>
              </div>
            )}

            <MiniChart
              symbol={symbol}
              interval={interval}
              days={days}
              indicatorStates={indicatorStates}
              vpConfig={vpConfig}
              vpFixedRange={vpFixedRange}
              oiMode={fullscreenOiMode}
              externalIndicatorManager={indicatorManagerRef.current}
              externalDrawingManager={drawingManagerRef.current}
              externalDrawingMode={drawingMode}
              onDrawingModeChange={setDrawingMode}
              onOpenVpSettings={onOpenVpSettings}
              onOpenRangeDetectionSettings={onOpenRangeDetectionSettings}
              onOpenRejectionPatternSettings={onOpenRejectionPatternSettings}
              onOpenSupportResistanceSettings={onOpenSupportResistanceSettings}
              onOpenVWAPSettings={onOpenVWAPSettings}
              onOpenFibonacciSettings={onOpenFibonacciSettings}
              onOpenContinuationPatternSettings={onOpenContinuationPatternSettings}
              onOpenDoubleTopBottomSettings={onOpenDoubleTopBottomSettings}
              onOpenSwingDetectorSettings={onOpenSwingDetectorSettings}
              rejectionPatternConfig={rejectionPatternConfig}
              isFullscreenChild={true}
              onDrawingsChanged={() => {
                // Sincronizar drawingsRef del padre con los shapes del manager
                if (drawingManagerRef.current) {
                  const shapes = drawingManagerRef.current.getShapes();
                  drawingsRef.current = shapes
                    .map(shapeData => deserializeShape(shapeData))
                    .filter(shape => shape !== null);
                  setDrawingsVersion(v => v + 1);
                  // Forzar redibujado
                  drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
                }
              }}
            />
          </div>
        </div>
      )}

      {showChartModal && (
        <ChartModal
          symbol={symbol}
          interval={interval}
          days={days}
          indicatorManagerRef={indicatorManagerRef}
          indicatorStates={indicatorStates}
          onToggleIndicator={(name) => {
            if (indicatorManagerRef.current) {
              indicatorManagerRef.current.toggleIndicator(name, !indicatorStates[name]);
              setIndicatorStates(prev => ({ ...prev, [name]: !prev[name] }));
            }
          }}
          onClose={async () => {
            setShowChartModal(false);
            await loadDrawings(); // ✅ FIX: await para asegurar que drawings carguen antes de redibujar
            drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
          }}
        />
      )}
    </>
  );
};

export default MiniChart;