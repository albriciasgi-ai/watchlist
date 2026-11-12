// src/components/MiniChart.jsx
// ✅ SOLUCIÓN COMPLETA: Sincronización automática de indicadores + Detección de gaps + Zoom Dinámico + Presets

import React, { useEffect, useLayoutEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { API_BASE_URL } from "../config";
import { DEFAULT_REWARD_RATIO } from "./drawing/shapes/TPSLBox";
import { candlesToFrame, contextBarWidth, viewIncluding } from "./backtesting/tradeJournal.js";
import wsManager from "./WebSocketManager";
import IndicatorManager from "./indicators/IndicatorManager";
import FixedRangeProfilesManager from "./FixedRangeProfilesManager";
import VolumeProfileFixedSettings from "./VolumeProfileFixedSettings";
import ZoomPresetsConfig from "./ZoomPresetsConfig";
import DrawingToolManager from "./drawing/DrawingToolManager";
import MeasurementTool from "./drawing/MeasurementTool";
import TPSLBox from "./drawing/shapes/TPSLBox"; // 🎯 Para crear cajas TP/SL programáticamente
import { TF_MS, countBefore, formingCandle, lastClosedIndex, syncKnownCandles, timestampIndex } from './backtesting/replayClock';
import { DEFAULT_PRICE_RATIO, resizePanel } from './indicators/panelLayout.js';
import {
  ROLES, candleCenterX, candleItemId, chosenLevel, drawChosenLevels, drawChosenMarks, framedTimes, imageMarkers, itemPositions, knownLevels, levelTargets,
  levelsNear, priceRangeWith, subscribeLevels, toggleLevel, updateLevel, withinArea
} from './indicators/analysisLevels.js';
import { subscribePins } from './indicators/liquidationPins.js';
import {
  alignX, alignY, candleColumns, crispWidth, installCrispRects, pixelRatio, resetCanvasMoves, screenDensity,
  setCanvasPixels, snapEdge, snapSpanY
} from './chartPixels.js';
import {
  THEME, crossTime, installThemeFonts, isNewTheme, isTimeTick, niceStep, niceTimeStep, priceDecimals, rgbOf, timeTick
} from './uiTheme.js';
import { useUiTheme } from './useUiTheme.js';
import { Icon } from './uiIcons.jsx';
import './backtesting/Observer.css';
import { isBlind, maskDate, maskPrice, maskVolume, priceText, pricesHidden, unmaskPrice } from './backtesting/blindClock';
import { drawPositionLines, hitPositionTarget } from './positionLines.js';

// Al acercarse, una vela ancha deja leer su footprint
const MAX_BAR_WIDTH = 400;
const MAX_ZOOM = MAX_BAR_WIDTH / 8;
const FOOTPRINT_ZOOM = 20; // Velas de 160px: se leen las cifras del footprint
const FOCUS_MIN_BAR_WIDTH = 6; // Al ir a un punto, velas más angostas no dejan distinguirlo
const FOCUS_MARK_MS = 15000; // Cuánto queda marcado el punto al que se fue
const CAPTURE_DENSITY = 2; // Píxeles de imagen por píxel CSS en las imágenes de trades, como mínimo

// Parámetros de fábrica del dibujo del volumen (modal de volumen)
const VOLUME_VISUAL_DEFAULTS = {
  intensityMin: 0.3,
  intensityMax: 1.0,
  intensityDivisor: 3,
  opacityMin: 0.4,
  opacityMax: 0.9,
  opacityBase: 0.5,
  opacityDivisor: 4,
  gradientBottomMultiplier: 0.3,
  glowThreshold: 2.0,
  glowBlur: 8,
  // 🎯 NUEVO: Detección de clusters de volumen alto consecutivo
  clusterDetection: true,
  clusterMinBars: 3,              // Mínimo de velas consecutivas para considerar cluster
  clusterThreshold: 0.5,           // Umbral promedio de z-score para cluster (0.5 = volumen moderadamente alto)
  clusterColorBullish: '#4CAF50',  // Color para clusters alcistas (verde)
  clusterColorBearish: '#F44336'   // Color para clusters bajistas (rojo)
};
// Con Nítido el volumen va en barras planas; si el usuario cambia alguno de estos en el modal, vuelve el degradado
const VOLUME_LOOK_KEYS = [
  'intensityMin', 'intensityMax', 'intensityDivisor', 'opacityMin', 'opacityMax', 'opacityBase', 'opacityDivisor',
  'gradientBottomMultiplier', 'glowThreshold', 'glowBlur'
];
const CAPTURE_LEVEL_ROOM_PX = 12; // Aire de un nivel que agranda el precio de una imagen: su etiqueta no queda cortada
const CAPTURE_MARK_ROOM_PX = 16; // Aire junto a una marca que aleja una imagen: su aro y su número no quedan en el borde
const MIN_VOLUME_HEIGHT = 40;
const isValidCandle = (d) => d.open > 0 && d.high > 0 && d.low > 0 && d.close > 0 &&
  d.high >= d.low && d.high >= d.open && d.high >= d.close &&
  d.low <= d.open && d.low <= d.close;
const PRICE_AXIS_WIDTH = 65;
const PANEL_BUTTON_STYLE = {
  width: '18px',
  height: '16px',
  padding: 0,
  fontSize: '9px',
  lineHeight: '14px',
  border: '1px solid #CFD8DC',
  borderRadius: '3px',
  background: '#FFFFFF',
  color: '#546E7A',
  cursor: 'pointer'
};

// ==================== LOGGING SYSTEM ====================
const DEBUG_MODE = false;

const log = {
  candle: (symbol, message, data = null) => {
    if (!DEBUG_MODE) return;
    const timestamp = new Date().toLocaleTimeString('es-CO', { hour12: false, fractionalSecondDigits: 3 });
    console.log(`[${timestamp}] 🕯️  ${symbol} | ${message}`, data || '');
  },
  
  ws: (symbol, message, data = null) => {
    if (!DEBUG_MODE) return;
    const timestamp = new Date().toLocaleTimeString('es-CO', { hour12: false, fractionalSecondDigits: 3 });
    console.log(`[${timestamp}] 📡 ${symbol} | ${message}`, data || '');
  },
  
  indicator: (symbol, message, data = null) => {
    if (!DEBUG_MODE) return;
    const timestamp = new Date().toLocaleTimeString('es-CO', { hour12: false, fractionalSecondDigits: 3 });
    console.log(`[${timestamp}] 📊 ${symbol} | ${message}`, data || '');
  },
  
  error: (symbol, message, error = null) => {
    const timestamp = new Date().toLocaleTimeString('es-CO', { hour12: false, fractionalSecondDigits: 3 });
    console.error(`[${timestamp}] ❌ ${symbol} | ${message}`, error || '');
  },
  
  state: (symbol, candlesCount, hasInProgress) => {
    if (!DEBUG_MODE) return;
    const timestamp = new Date().toLocaleTimeString('es-CO', { hour12: false, fractionalSecondDigits: 3 });
    console.log(`[${timestamp}] 🔍 ${symbol} | Estado: ${candlesCount} confirmadas, En progreso: ${hasInProgress ? 'SÍ' : 'NO'}`);
  }
};

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
    "W": 604800000,
    // Marcos con letra (App 1 y la suite)
    "1m": 60000, "3m": 180000, "5m": 300000, "15m": 900000, "30m": 1800000,
    "1h": 3600000, "2h": 7200000, "4h": 14400000, "1d": 86400000, "1D": 86400000, "1w": 604800000, "1W": 604800000
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

// Las velas de backtesting traen solo timestamp: hora de Colombia, UTC-5
const colombiaTime = (timestamp) => new Date(timestamp - 5 * 3600000).toISOString().slice(0, 19).replace("T", " ");

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

const MiniChart = forwardRef(({
  symbol,
  interval,
  days,
  indicatorStates,
  vpConfig,
  vpFixedRange,
  oiMode,
  getTradeBoundaries,
  getTradeBoxes = null, // Cajas TP/SL de los trades, para el 2.º gráfico: { side, entry, stop, target, start, end }
  getPositionLines = null, // Posiciones y órdenes reales (suite en vivo), ver positionLines.js. App 1 no lo pasa
  onPositionAction = null, // { type: 'close' | 'cancel' | 'move' | 'remove', line, field, price }: lo decide quien da los datos
  onOpenVpSettings,
  onOpenRangeDetectionSettings,
  onOpenRejectionPatternSettings,
  onOpenSupportResistanceSettings,
  onOpenVWAPSettings,
  onOpenDoubleTopBottomSettings,
  onOpenSwingDetectorSettings,
  onOpenOIVolumeConfluenceSettings,
  rejectionPatternConfig,
  // 🎯 NUEVO: Props para modo backtesting
  backtestingMode = false,
  backtestingData = null,
  currentTime = null,
  isActive = true,  // Solo el gráfico a la vista sigue la reproducción
  simulationStartTime = null,  // 🎯 NUEVO: Fecha de inicio de la simulación (para anti-sesgo en Order Flow)
  onRequestPause = null,  // 🎯 NUEVO: Callback para pausar reproducción al hacer paneo
  onRequestTimeChange = null,  // 🎯 NUEVO: Callback para cambiar el tiempo de playback (navegación a zonas)
  // 🎯 NUEVO: Props para drawing tools
  currentTool = 'select',
  onToolChange = null,
  onDrawingsChange = null  // 🔧 FIX: Callback para sincronizar dibujos entre tabs
}, ref) => {
  const canvasRef = useRef(null);
  const positionTargetsRef = useRef([]); // Etiquetas de posiciones que responden al mouse (último dibujo)
  const positionDragRef = useRef(null);  // SL o TP que se está arrastrando: { lineId, line, field, price, startY, moved }
  const positionPressRef = useRef(null); // × presionada: la acción sale al soltar sobre la misma ×
  const positionPriceRef = useRef(null); // Último precio con que se dibujaron las posiciones (va en cada acción)

  const candlesRef = useRef([]);
  const inProgressCandleRef = useRef(null);

  const lastPriceRef = useRef(null);
  const animationFrameRef = useRef(null);
  const mountedRef = useRef(true);
  const indicatorManagerRef = useRef(null);

  // ✅ NUEVO: Referencia para chequeo de gaps
  const gapCheckIntervalRef = useRef(null);

  // 🎯 NUEVO: Referencias para sistema de dibujo
  const drawingManagerRef = useRef(null);
  const measurementToolRef = useRef(null);
  const scaleConverterRef = useRef(null); // Guardar scaleConverter actualizado para eventos de mouse

  const [mousePos, setMousePos] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenOiMode, setFullscreenOiMode] = useState(oiMode || "histogram");
  const [showFixedRangeManager, setShowFixedRangeManager] = useState(false);
  const [showFollowButton, setShowFollowButton] = useState(false);  // 🎯 NUEVO: Mostrar botón Follow cuando hay paneo manual
  const [chartRectangles, setChartRectangles] = useState([]);
  const pendingVPFixedFromRectRef = useRef(false);

  // 🎯 NUEVO: Array de límites de trades (para dibujar líneas verticales permanentes)
  // 🔧 FIX: Cambiar de single trade a array para acumular todos los trades

  // Actualizar fullscreenOiMode cuando cambia oiMode del padre
  useEffect(() => {
    if (oiMode) {
      setFullscreenOiMode(oiMode);
    }
  }, [oiMode]);

  // isActive en un ref: los manejadores de la ventana lo leen sin volver a registrarse
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  // 🎯 NUEVO: Sincronizar herramienta de dibujo
  useEffect(() => {
    if (drawingManagerRef.current && currentTool) {
      drawingManagerRef.current.setTool(currentTool);
      console.log(`[${symbol}] Drawing tool changed to: ${currentTool}`);
    }
  }, [currentTool, symbol]);

  // 🎯 NUEVO: Handler para teclas Delete y Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      // Hay un MiniChart por marco y todos escuchan la ventana: solo responde el que esta a la vista.
      // Antes los ocultos guardaban su lista sin borrar a la vez, y en vivo el dibujo volvia a aparecer
      if (!isActiveRef.current) return;

      // Delete: borrar shape seleccionado
      if (e.key === 'Delete' && drawingManagerRef.current && !typing) {
        const before = drawingManagerRef.current.shapes.length;
        drawingManagerRef.current.deleteSelected();
        if (drawingManagerRef.current.shapes.length === before) return; // nada seleccionado: no se guarda
        saveDrawings();
        drawChart(candlesRef.current, lastPriceRef.current, null, null);
        console.log(`[${symbol}] Shape deleted with Delete key`);
      }

      // Escape: cancelar medición
      if (e.key === 'Escape' && measurementToolRef.current && measurementToolRef.current.isMeasuring()) {
        measurementToolRef.current.clear();
        drawChart(candlesRef.current, lastPriceRef.current, null, null);
        console.log(`[${symbol}] Measurement cancelled with Escape`);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [symbol]);

  // 🎯 NUEVO: Exponer métodos de drawing manager al componente padre
  useImperativeHandle(ref, () => ({
    undo: () => {
      if (drawingManagerRef.current) {
        drawingManagerRef.current.undo();
        saveDrawings();
        drawChart(candlesRef.current, lastPriceRef.current, null, null);
      }
    },
    redo: () => {
      if (drawingManagerRef.current) {
        drawingManagerRef.current.redo();
        saveDrawings();
        drawChart(candlesRef.current, lastPriceRef.current, null, null);
      }
    },
    clearAll: () => {
      if (drawingManagerRef.current) {
        drawingManagerRef.current.clearAll();
        saveDrawings();
        drawChart(candlesRef.current, lastPriceRef.current, null, null);
      }
    },
    // 🎯 NUEVO: Obtener dibujos serializados (para guardar sesión)
    getDrawings: () => {
      if (drawingManagerRef.current) {
        return drawingManagerRef.current.getShapes();
      }
      return [];
    },
    // 🎯 NUEVO: Cargar dibujos desde sesión
    loadDrawings: (shapesData, skipSync = false) => {
      if (drawingManagerRef.current && shapesData) {
        drawingManagerRef.current.loadShapes(shapesData);

        // 🔧 FIX: Solo sincronizar si no viene de sincronización (evitar loop infinito)
        if (!skipSync) {
          saveDrawings();
        }

        drawChart(candlesRef.current, lastPriceRef.current, null, null);
        console.log(`[MiniChart ${symbol} ${interval}] Dibujos cargados:`, shapesData.length, skipSync ? '(sin sync)' : '');
      }
    },
    // 🔧 FIX: Forzar redibujado del canvas (útil al cambiar de tab)
    forceRedraw: () => {
      if (candlesRef.current && candlesRef.current.length > 0) {
        drawChart(candlesRef.current, lastPriceRef.current, null, null);
        console.log(`[MiniChart ${symbol} ${interval}] Canvas forzado a redibujar`);
      }
    },
    // Lo que responde al mouse en las posiciones reales (último dibujo), para revisar desde la consola
    getPositionTargets: () => positionTargetsRef.current,
    // 🎯 NUEVO: Obtener el IndicatorManager (para acceso directo desde BacktestingApp)
    getIndicatorManager: () => {
      return indicatorManagerRef.current;
    },
    // Orden y altura de fábrica, también para la parte del precio que se movió al arrastrar
    resetPanels: () => {
      indicatorManagerRef.current?.resetPanels();
      localStorage.removeItem(`priceChartRatio_${symbol}`);
      setPriceChartRatio(DEFAULT_PRICE_RATIO);
      setPanelVersion(version => version + 1);
    },
    // 🎯 NUEVO: Precalcular todos los indicadores con velas completas
    precalculateIndicators: async (candles, playbackStartTime = null) => {
      if (indicatorManagerRef.current && candles && candles.length > 0) {
        console.log(`[MiniChart ${symbol} ${interval}] 🚀 Iniciando precálculo de indicadores con ${candles.length} velas...`);
        if (playbackStartTime) {
          console.log(`[MiniChart ${symbol} ${interval}] 📅 playbackStartTime: ${new Date(playbackStartTime).toISOString()}`);
        }
        try {
          await indicatorManagerRef.current.precalculateAllIndicators(candles, playbackStartTime);
          console.log(`[MiniChart ${symbol} ${interval}] ✅ Precálculo completado`);
          return true;
        } catch (error) {
          console.error(`[MiniChart ${symbol} ${interval}] ❌ Error en precálculo:`, error);
          return false;
        }
      }
      return false;
    },
    // 🎯 NUEVO: Agregar caja TP/SL programáticamente (para órdenes de trading)
    addTPSLBox: (entryPrice, time, direction, stopLoss, takeProfit, candleWidthCount = 5) => {
      if (!drawingManagerRef.current) {
        console.warn(`[MiniChart ${symbol} ${interval}] DrawingManager no disponible`);
        return null;
      }

      // Calcular ancho basado en número de velas
      const intervalMs = {
        '1': 60000, '3': 180000, '5': 300000, '15': 900000, '30': 1800000,
        '60': 3600000, '120': 7200000, '240': 14400000, 'D': 86400000, 'W': 604800000
      }[interval] || 900000;

      const boxWidthMs = candleWidthCount * intervalMs;

      // Crear TPSLBox con valores personalizados
      const box = new TPSLBox(entryPrice, time, direction);
      box.timeStart = time;
      box.timeEnd = time + boxWidthMs;
      box.time = time + boxWidthMs / 2; // Centro

      // Usar TP/SL de la orden. Si falta uno, se completa con riesgo beneficio de 2
      const hasStop = stopLoss !== null && stopLoss !== undefined;
      const hasTarget = takeProfit !== null && takeProfit !== undefined;
      if (hasStop) {
        box.slPrice = stopLoss;
        if (!hasTarget) box.tpPrice = entryPrice + (entryPrice - stopLoss) * DEFAULT_REWARD_RATIO;
      }
      if (hasTarget) {
        box.tpPrice = takeProfit;
        if (!hasStop) box.slPrice = entryPrice - (takeProfit - entryPrice) / DEFAULT_REWARD_RATIO;
      }

      // Agregar al manager
      drawingManagerRef.current.addShape(box);
      drawingManagerRef.current.saveToHistory();

      // Guardar y redibujar
      saveDrawings();
      if (candlesRef.current && candlesRef.current.length > 0) {
        drawChart(candlesRef.current, lastPriceRef.current, null, null);
      }

      console.log(`[MiniChart ${symbol} ${interval}] ✅ TPSLBox creado:`, {
        boxId: box.id,
        entry: entryPrice,
        sl: box.slPrice,
        tp: box.tpPrice,
        direction,
        width: candleWidthCount,
        totalShapes: drawingManagerRef.current.shapes.length
      });

      return box.id;
    },
    // La caja dibujada pasa a ser la del trade: empieza en la entrada real
    anchorTPSLBox: (boxId, time, entryPrice) => {
      const box = drawingManagerRef.current?.shapes.find(shape => shape.id === boxId && shape.type === 'tpsl');
      if (!box) return false;

      const width = box.timeEnd - box.timeStart;
      box.timeStart = time;
      box.timeEnd = time + width;
      box.time = time + width / 2;
      box.entryPrice = entryPrice;

      drawingManagerRef.current.saveToHistory();
      saveDrawings();
      drawChartRef.current?.(candlesRef.current, lastPriceRef.current, null, null);
      return true;
    },
    // 🎯 NUEVO: Extender caja TP/SL hasta el timestamp de cierre del trade
    extendTPSLBox: (boxId, exitTime) => {
      console.log(`[MiniChart ${symbol} ${interval}] 🔍 Intentando extender TP/SL box:`, {
        boxId,
        exitTime,
        exitTimeDate: new Date(exitTime).toISOString(),
        hasDrawingManager: !!drawingManagerRef.current,
        totalShapesNow: drawingManagerRef.current?.shapes.length || 0
      });

      if (!drawingManagerRef.current) {
        console.warn(`[MiniChart ${symbol} ${interval}] DrawingManager no disponible para extender TP/SL box`);
        return false;
      }

      // Listar todas las shapes disponibles
      console.log(`[MiniChart ${symbol} ${interval}] Shapes disponibles (${drawingManagerRef.current.shapes.length}):`,
        drawingManagerRef.current.shapes.map(s => ({ id: s.id, type: s.type }))
      );

      // Buscar la caja por ID
      const box = drawingManagerRef.current.shapes.find(shape =>
        shape.id === boxId && shape.type === 'tpsl'
      );

      if (!box) {
        console.warn(`[MiniChart ${symbol} ${interval}] ⚠️ TP/SL box ${boxId} no encontrado`);
        console.log(`[MiniChart ${symbol} ${interval}] Total shapes: ${drawingManagerRef.current.shapes.length}`);
        return false;
      }

      console.log(`[MiniChart ${symbol} ${interval}] ✅ Box encontrado:`, {
        id: box.id,
        type: box.type,
        timeStart: box.timeStart,
        timeStartDate: new Date(box.timeStart).toISOString(),
        timeEnd_antes: box.timeEnd,
        timeEnd_antesDate: new Date(box.timeEnd).toISOString(),
        timeEnd_nuevo: exitTime,
        timeEnd_nuevoDate: new Date(exitTime).toISOString()
      });

      // Actualizar timeEnd al timestamp de salida
      box.timeEnd = exitTime;
      // Recalcular el centro de la caja
      box.time = box.timeStart + (exitTime - box.timeStart) / 2;

      console.log(`[MiniChart ${symbol} ${interval}] 📝 Box actualizado:`, {
        timeEnd_despues: box.timeEnd,
        timeEnd_despuesDate: new Date(box.timeEnd).toISOString(),
        time_center: box.time,
        time_centerDate: new Date(box.time).toISOString()
      });

      // Guardar cambios y redibujar
      drawingManagerRef.current.saveToHistory();
      saveDrawings();

      if (candlesRef.current && candlesRef.current.length > 0) {
        drawChart(candlesRef.current, lastPriceRef.current, null, null);
      }

      console.log(`[MiniChart ${symbol} ${interval}] ✅ TP/SL box ${boxId} extendido hasta ${new Date(exitTime).toISOString()}`);
      return true;
    },
    // 🎯 NUEVO: Centrar el chart en un timestamp específico
    centerOnTimestamp: (timestamp, options = {}) => {
      const { animate = true, duration = 500 } = options;

      // 🎯 FIX NAVEGACIÓN A TRADES: En backtesting, usar allCandlesRef para buscar trades históricos
      // y actualizar el currentTime del playback para que candlesRef se reconstruya correctamente
      const sourceCandles = backtestingMode && allCandlesRef.current?.length > 0
        ? allCandlesRef.current
        : candlesRef.current;

      if (!sourceCandles || sourceCandles.length === 0) {
        console.warn(`[MiniChart ${symbol}] ⚠️ No hay velas para centrar`);
        return;
      }

      // 🔍 DEBUG: Log del rango de velas disponibles
      const firstTs = sourceCandles[0].timestamp;
      const lastTs = sourceCandles[sourceCandles.length - 1].timestamp;
      console.log(`[MiniChart ${symbol}] 🔍 centerOnTimestamp: buscando ${timestamp} (${new Date(timestamp).toISOString()})`);
      console.log(`[MiniChart ${symbol}] 🔍 Fuente: ${backtestingMode ? 'allCandlesRef (histórico completo)' : 'candlesRef (actual)'}`);
      console.log(`[MiniChart ${symbol}] 🔍 Rango disponible: ${new Date(firstTs).toISOString()} → ${new Date(lastTs).toISOString()}`);
      console.log(`[MiniChart ${symbol}] 🔍 Total velas: ${sourceCandles.length}`);

      // Encontrar índice de la vela más cercana al timestamp
      let targetIndex = -1;
      for (let i = 0; i < sourceCandles.length; i++) {
        if (sourceCandles[i].timestamp >= timestamp) {
          targetIndex = i;
          break;
        }
      }

      // Si no encontramos ninguna vela >= timestamp, ir a la última
      if (targetIndex === -1) {
        console.log(`[MiniChart ${symbol}] ⚠️ Timestamp después del rango, usando última vela`);
        targetIndex = sourceCandles.length - 1;
      }

      const targetCandle = sourceCandles[targetIndex];
      console.log(`[MiniChart ${symbol}] ✅ Vela encontrada en índice ${targetIndex}: ${new Date(targetCandle.timestamp).toISOString()}`);

      // 🎯 FIX NAVEGACIÓN A TRADES: En backtesting, actualizar currentTime para reconstruir candlesRef
      if (backtestingMode && onRequestTimeChange) {
        console.log(`[MiniChart ${symbol}] 📍 Actualizando playback time a: ${new Date(targetCandle.timestamp).toISOString()}`);

        // 🔧 FIX "BAILE DEL GRÁFICO": Marcar como paneo manual temporalmente
        // Esto evita que el useEffect(currentTime) recalcule el offset automáticamente
        // mientras se reconstruye candlesRef, lo cual causaba el "baile" al mover el mouse
        const wasManualPan = manualPanRef.current;
        manualPanRef.current = true;

        onRequestTimeChange(Math.min(targetCandle.timestamp, simulatedNowRef.current ?? targetCandle.timestamp));

        // Restaurar el estado original después de que el useEffect termine
        setTimeout(() => {
          manualPanRef.current = wasManualPan;
          console.log(`[MiniChart ${symbol}] 🔄 Restaurado manualPan=${wasManualPan}`);
        }, 300);

        // El playback se encargará de reconstruir candlesRef con el rango correcto
        return; // Salir aquí, el update de currentTime disparará el re-render
      }

      // 🎯 FALLBACK: Si no estamos en backtesting o no hay callback, navegar visualmente
      // (comportamiento original para modo no-backtesting)

      // Calcular cuántas velas caben en la pantalla con el zoom actual
      const canvas = canvasRef.current;
      if (!canvas) return;

      const chartWidth = Math.floor(canvas.getBoundingClientRect().width); // En píxeles CSS, no los del lienzo
      const candleWidth = 8;
      const zoom = viewStateRef.current.zoom || 1;
      const candlesPerScreen = Math.floor(chartWidth / (candleWidth * zoom));

      // Posicionar el target en el centro de la pantalla
      const targetOffset = Math.max(0, targetIndex - Math.floor(candlesPerScreen / 2));

      // 🎯 FIX CHART FLIP: Usar candlesRef para calcular maxOffset (consistente con el resto del código)
      const maxOffset = Math.max(0, candlesRef.current.length - candlesPerScreen);
      const clampedTargetOffset = Math.min(targetOffset, maxOffset);

      // 🎯 NUEVO: Marcar que el usuario navegó manualmente (mostrar botón Follow)
      if (backtestingMode) {
        manualPanRef.current = true;
        setShowFollowButton(true);
        if (onRequestPause) {
          onRequestPause();
        }
      }

      // 🎯 NUEVO: Animación suave de navegación
      if (animate && viewStateRef.current.offset !== clampedTargetOffset) {
        const startOffset = viewStateRef.current.offset;
        const distance = Math.abs(clampedTargetOffset - startOffset);

        // Duración adaptativa: mayor distancia = más tiempo (300ms-1000ms)
        const adaptiveDuration = Math.min(1000, Math.max(300, duration * (distance / candlesPerScreen)));
        const startTime = performance.now();

        const animateStep = (currentTime) => {
          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / adaptiveDuration, 1);

          // Easing function (easeInOutCubic) para animación suave
          const eased = progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;

          const currentOffset = startOffset + (clampedTargetOffset - startOffset) * eased;
          viewStateRef.current.offset = Math.round(currentOffset);

          // 🎯 FIX CHART FLIP: Dibujar con candlesRef para evitar el volteo
          drawChart(candlesRef.current, lastPriceRef.current, null, null);

          if (progress < 1) {
            requestAnimationFrame(animateStep);
          } else {
            console.log(`[MiniChart ${symbol}] 🎯 Animación completada - Centrado en timestamp ${timestamp} (índice ${targetIndex}, offset ${viewStateRef.current.offset})`);
          }
        };

        requestAnimationFrame(animateStep);
        console.log(`[MiniChart ${symbol}] 🎬 Iniciando animación suave (${adaptiveDuration.toFixed(0)}ms)`);
      } else {
        // Sin animación: salto instantáneo
        viewStateRef.current.offset = clampedTargetOffset;

        // 🎯 FIX CHART FLIP: Dibujar con candlesRef para evitar el volteo
        drawChart(candlesRef.current, lastPriceRef.current, null, null);

        console.log(`[MiniChart ${symbol}] 🎯 Centrado instantáneo en timestamp ${timestamp} (índice ${targetIndex}, offset ${viewStateRef.current.offset})`);
      }
    },
    isShown: () => (canvasRef.current?.getBoundingClientRect().width ?? 0) > 0,

    // Lleva la vista a una vela ya ocurrida, sin mover la hora simulada, y la marca un momento
    // (sin marca con mark: false, como al ir a un trade, que ya tiene su línea)
    focusOn: (time, price = null, { mark = true } = {}) => {
      const candles = candlesRef.current;
      const chartWidth = priceScaleRef.current?.chartWidth;
      if (!candles?.length || !chartWidth) return false;

      const index = countBefore(candles, time + 1) - 1;
      if (index < 0) return false;

      const view = viewStateRef.current;
      if (8 * view.zoom < FOCUS_MIN_BAR_WIDTH) view.zoom = FOCUS_MIN_BAR_WIDTH / 8;
      const perScreen = Math.floor(chartWidth / Math.max(0.1, Math.min(MAX_BAR_WIDTH, 8 * view.zoom)));
      // El punto queda a 40% del ancho: a la derecha se ve lo que pasó después
      view.offset = Math.max(0, candles.length - perScreen - (index - Math.floor(perScreen * 0.4)));
      view.verticalZoom = 1;
      view.verticalOffset = 0;
      manualPanRef.current = true;
      setShowFollowButton(true);
      onRequestPause?.();

      if (mark) {
        focusMarkRef.current = { time: candles[index].timestamp, price, until: performance.now() + FOCUS_MARK_MS };
        setTimeout(() => {
          if (candlesRef.current?.length > 0) drawChartRef.current?.(candlesRef.current, lastPriceRef.current, null, null, true);
        }, FOCUS_MARK_MS + 50);
      }
      drawChartRef.current?.(candles, lastPriceRef.current, null, null, true);
      return true;
    },

    // 📸 Guarda una imagen del gráfico. Con showFrom la encuadra desde esa hora sin cambiar la vista
    // del usuario. keepInView hace lo mismo solo si quien opera se alejó de la vela más reciente.
    // Con context muestra unas 5 veces las velas a la vista, también sin cambiar la vista.
    // Con items dibuja lo elegido para esa orden, no la lista del panel, que ya es la del trade siguiente,
    // y lo deja todo en la imagen: el precio abarca cada nivel y la vista alcanza la vela de cada marca
    captureScreenshot: async (sessionId, orderId, { showFrom = null, keepInView = null, context = false, onCopied = null, items = null } = {}) => {
      return new Promise((resolve, reject) => {
        const canvas = canvasRef.current;
        if (!canvas) {
          reject(new Error('Canvas no disponible'));
          return;
        }
        // Oculto no se redibuja: la imagen mostraría un momento anterior
        if (canvas.getBoundingClientRect().width === 0) {
          reject(new Error('Gráfico oculto'));
          return;
        }

        console.log(`[MiniChart ${symbol}] 📸 Capturando screenshot para order ${orderId}...`);

        const shownAt = simulatedNowRef.current;
        const userView = { ...viewStateRef.current };
        const ownItems = Array.isArray(items);
        const frameFrom = showFrom ?? (viewStateRef.current.offset > 0 ? keepInView : null);
        if (frameFrom) frameChartFrom(frameFrom);
        if (context) widenChart();
        const itemsFramed = ownItems && frameItems(items);
        const viewChanged = Boolean(frameFrom || context || itemsFramed);

        // Lo más reciente y sin la cruceta del mouse ni la marca de "Ir al gráfico"
        const focus = focusMarkRef.current;
        focusMarkRef.current = null;
        captureItemsRef.current = ownItems ? items : null;
        // La imagen sale con al menos el doble de píxeles que la pantalla: se puede ampliar sin perder detalle
        const screen = screenDensity();
        captureDensityRef.current = screen === null ? null : Math.max(CAPTURE_DENSITY, screen);
        if (candlesRef.current?.length > 0) {
          drawChartRef.current?.(candlesRef.current, lastPriceRef.current, null, null, true);
        }
        captureItemsRef.current = null;
        focusMarkRef.current = focus;
        const imageSize = { width: canvas.width, height: canvas.height };

        // Dónde quedó en la imagen cada nivel o marca de la orden, como parte del ancho y del alto
        const drawn = lastAreaRef.current;
        const size = drawnSizeRef.current;
        const markers = items?.length && drawn && size
          ? imageMarkers(itemPositions(items, drawn.offered, drawn.area, { edges: true }), size.width, size.height)
          : [];

        // Convertir canvas a blob (PNG)
        canvas.toBlob(async (blob) => {
          if (!blob) {
            reject(new Error('No se pudo generar blob del canvas'));
            return;
          }

          try {
            // Crear FormData para enviar el blob
            const formData = new FormData();
            formData.append('file', blob, `order_${orderId}.png`);

            // Enviar al backend
            const response = await fetch(`${API_BASE_URL}/api/screenshots/session/${sessionId}`, {
              method: 'POST',
              body: formData
            });

            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();

            if (result.success) {
              console.log(`[MiniChart ${symbol}] ✅ Screenshot guardado: ${result.screenshotPath}`);
              resolve({
                screenshotPath: result.screenshotPath,
                screenshotCaptured: true,
                screenshotTimestamp: Date.now(),
                screenshotSimTime: shownAt,
                screenshotFrame: interval,
                screenshotMarkers: markers,
                screenshotMetadata: {
                  width: imageSize.width,
                  height: imageSize.height,
                  size: result.metadata.size
                }
              });
            } else {
              reject(new Error('Backend retornó success: false'));
            }
          } catch (error) {
            console.error(`[MiniChart ${symbol}] ❌ Error guardando screenshot:`, error);
            reject(error);
          }
        }, 'image/png');

        // toBlob ya copió la imagen: la vista, lo elegido y la densidad de la pantalla vuelven antes de que se pinte
        const densityChanged = captureDensityRef.current !== null;
        captureDensityRef.current = null;
        if (viewChanged || ownItems || densityChanged) {
          if (viewChanged) Object.assign(viewStateRef.current, userView);
          if (candlesRef.current?.length > 0) {
            drawChartRef.current?.(candlesRef.current, lastPriceRef.current, null, null, true);
          }
        }
        onCopied?.();
      });
    },
    // Vuelve a dibujar cuando cambian los trades
    redraw: () => {
      if (candlesRef.current && candlesRef.current.length > 0) {
        drawChartRef.current?.(candlesRef.current, lastPriceRef.current, null, null);
      }
    },
    // Promedio de ms de los últimos dibujos por cambio de hora. El 2.º gráfico avanza la hora en cada
    // cuadro de la pantalla y con esto baja el ritmo cuando el dibujo es caro (miles de velas a la vista)
    // Tras una pausa la medida ya no vale (pudo cambiar el zoom): se empieza de nuevo
    drawCost: () => (performance.now() - drawCostRef.current.at < 1000 ? drawCostRef.current.ms : 0)
  }), [symbol, interval]);

  const [fixedRangeProfiles, setFixedRangeProfiles] = useState([]);
  const [configuringProfileId, setConfiguringProfileId] = useState(null);
  const [currentProfileConfig, setCurrentProfileConfig] = useState(null);
  const viewStateRef = useRef({ offset: 0, zoom: 1, verticalOffset: 0, verticalZoom: 1 });
  const priceScaleRef = useRef(null); // Escala del último dibujo
  const drawChartRef = useRef(null); // Última versión de drawChart, para redibujar desde indicadores
  const devicePixelsRef = useRef(null); // Píxeles reales que ocupa el lienzo en pantalla, del ResizeObserver
  const captureDensityRef = useRef(null); // Densidad pedida al tomar una imagen de trade
  const drawnSizeRef = useRef(null); // Tamaño CSS del lienzo en el último dibujo
  const priceDecimalsRef = useRef(null); // Decimales del precio de la moneda, para los ejes de Nítido
  const uiTheme = useUiTheme();
  const simulatedNowRef = useRef(null);
  simulatedNowRef.current = currentTime;
  const dragStateRef = useRef({ isDragging: false, startX: 0, startY: 0, startOffset: 0, startVerticalOffset: 0 });
  const manualPanRef = useRef(false); // 🎯 NUEVO: Detectar si el usuario hizo paneo manual
  const rafRef = useRef(null); // Para requestAnimationFrame
  const pendingDrawRef = useRef(null); // Lo último que se pidió dibujar mientras se espera el cuadro
  const drawCostRef = useRef({ ms: 0, at: 0 }); // Costo reciente de un dibujo por cambio de hora, y cuándo se midió
  const allCandlesRef = useRef([]); // Almacena todas las velas para binary search
  const lastIndexRef = useRef(-1); // Para detectar cambios reales de vela
  const formingKeyRef = useRef(0); // Para detectar avances de la vela en formacion
  const initialRenderDoneRef = useRef(false); // Para forzar primer render cuando se carga currentTime
  const lastRenderTimeRef = useRef(0); // Para throttling agresivo

  // 🎯 NUEVO: Estados para sistema de presets de zoom
  const [showPresetsConfig, setShowPresetsConfig] = useState(false);
  const [zoomPresets, setZoomPresets] = useState([]);
  const [activePreset, setActivePreset] = useState(null);

  // 🎯 NUEVO: Estado para divisor redimensionable (proporción de altura del precio chart)
  const [priceChartRatio, setPriceChartRatio] = useState(() => {
    const saved = localStorage.getItem(`priceChartRatio_${symbol}`);
    return saved ? parseFloat(saved) : DEFAULT_PRICE_RATIO;
  });
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);
  const [priceAreaBottom, setPriceAreaBottom] = useState(null); // Dónde termina el precio, en píxeles

  // 🎯 NUEVO: Estado para altura ajustable del panel de volumen
  const [volumeHeight, setVolumeHeight] = useState(() => {
    const saved = localStorage.getItem(`volumeHeight_${symbol}`);
    return saved ? parseInt(saved) : 80; // 80px por defecto (aumentado de 50)
  });
  const [isDraggingVolumeDivider, setIsDraggingVolumeDivider] = useState(false);

  // Niveles y marcas que se pueden incluir en el análisis, y el menú abierto sobre uno
  const levelTargetsRef = useRef([]);
  const lastAreaRef = useRef(null); // Escala y elegibles del último dibujo, para ubicar las marcas de una imagen
  const captureItemsRef = useRef(null); // Lo elegido para la orden mientras se toma su imagen
  const levelMenuRef = useRef(null);
  const focusMarkRef = useRef(null); // Punto al que se fue desde una imagen
  const [levelMenu, setLevelMenu] = useState(null);
  const [textEditor, setTextEditor] = useState(null); // Caja de texto en edición: { id, x, y, width, height, value }
  const textEditorRef = useRef(null);
  const textAreaRef = useRef(null);
  // Al abrir el editor, el cursor queda en él (con doble clic el foco puede quedar en el gráfico)
  useEffect(() => {
    if (!textEditor?.id) return undefined;
    const timer = setTimeout(() => textAreaRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [textEditor?.id]);
  const [, setLevelVersion] = useState(0);

  // El menú crece al marcar: se acomoda para no salirse del gráfico, también al agrandar una nota
  useLayoutEffect(() => {
    const menu = levelMenuRef.current;
    if (!levelMenu || !menu || typeof ResizeObserver === 'undefined') return undefined;
    const fit = () => {
      const box = menu.offsetParent;
      if (!box) return;
      menu.style.top = `${Math.max(0, Math.min(levelMenu.y, box.clientHeight - menu.offsetHeight))}px`;
      menu.style.left = `${Math.max(0, Math.min(levelMenu.x, box.clientWidth - menu.offsetWidth))}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(menu);
    return () => observer.disconnect();
  }, [levelMenu]);

  // Paneles a la vista, para ubicar sus bordes y flechas sobre el canvas
  const [panels, setPanels] = useState([]);
  const [panelVersion, setPanelVersion] = useState(0);
  const [resizingPanel, setResizingPanel] = useState(null);
  const panelsKeyRef = useRef('');
  const panelResizeRef = useRef(null);

  // 🎯 NUEVO: Estados para parámetros de visualización de volumen
  const [showVolumeSettings, setShowVolumeSettings] = useState(false);
  const [volumeVisualParams, setVolumeVisualParams] = useState(() => {
    // 🔧 FIX: Merge de valores guardados con defaults para evitar propiedades undefined
    const defaults = VOLUME_VISUAL_DEFAULTS;

    const saved = localStorage.getItem(`volumeVisualParams_${symbol}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Merge: defaults primero, luego sobrescribir con valores guardados
        return { ...defaults, ...parsed };
      } catch (e) {
        console.error('Error parsing volumeVisualParams:', e);
        return defaults;
      }
    }
    return defaults;
  });

  const getBybitInterval = (interval) => {
    const map = {
      "1": "1", "3": "3", "5": "5", "15": "15", "30": "30",
      "60": "60", "120": "120", "240": "240", "D": "D", "W": "W",
      // Marcos con letra (App 1 y la suite): antes caian todos en "15" y cada grafico recibia las velas de 15m
      "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30",
      "1h": "60", "2h": "120", "4h": "240", "1d": "D", "1D": "D", "1w": "W", "1W": "W"
    };
    return map[interval] || "15";
  };

  // 🎯 NUEVO: Función centralizada para crear scaleConverter consistente
  const createScaleConverter = (visibleCandles, displayCandles, minPrice, maxPrice, yScale, verticalOffset, chartWidth, priceChartHeight, marginLeft, marginTop, barWidth) => {
    if (!visibleCandles || visibleCandles.length === 0) return null;

    return {
      candles: displayCandles,
      visibleCandles: visibleCandles,
      chartWidth,
      chartHeight: priceChartHeight,
      marginLeft,
      marginTop,
      interval: interval, // 🔧 FIX: Agregar interval para MeasurementTool

      priceToY: (price) => {
        return marginTop + priceChartHeight - (price - minPrice) * yScale + verticalOffset;
      },

      yToPrice: (y) => {
        const adjustedY = y - marginTop - verticalOffset;
        const priceFromTop = (priceChartHeight - adjustedY) / yScale;
        return minPrice + priceFromTop;
      },

      timeToX: (timestamp) => {
        // 🔧 FIX: Interpolar posición cuando timestamp no coincide exactamente
        // Esto permite que dibujos se vean en todos los timeframes (como TradingView)

        if (!visibleCandles || visibleCandles.length === 0) return null;

        // Caso 1: Timestamp antes de la primera vela visible
        if (timestamp < visibleCandles[0].timestamp) {
          // Extrapolar hacia la izquierda
          const firstCandle = visibleCandles[0];
          const secondCandle = visibleCandles[1];
          if (!secondCandle) return null;

          const candleDuration = secondCandle.timestamp - firstCandle.timestamp;
          const offsetCandles = (firstCandle.timestamp - timestamp) / candleDuration;
          return marginLeft - (offsetCandles * barWidth);
        }

        // Caso 2: Timestamp después de la última vela visible
        const lastCandle = visibleCandles[visibleCandles.length - 1];
        if (timestamp > lastCandle.timestamp) {
          // Extrapolar hacia la derecha
          const secondLastCandle = visibleCandles[visibleCandles.length - 2];
          if (!secondLastCandle) return null;

          const candleDuration = lastCandle.timestamp - secondLastCandle.timestamp;
          const offsetCandles = (timestamp - lastCandle.timestamp) / candleDuration;
          return marginLeft + ((visibleCandles.length - 1) * barWidth) + (barWidth / 2) + (offsetCandles * barWidth);
        }

        // Caso 3: Timestamp dentro del rango visible - interpolar
        for (let i = 0; i < visibleCandles.length - 1; i++) {
          const currentCandle = visibleCandles[i];
          const nextCandle = visibleCandles[i + 1];

          if (timestamp >= currentCandle.timestamp && timestamp <= nextCandle.timestamp) {
            // Interpolar entre las dos velas
            const candleDuration = nextCandle.timestamp - currentCandle.timestamp;
            const relativePosition = (timestamp - currentCandle.timestamp) / candleDuration;

            const xCurrent = marginLeft + (i * barWidth) + (barWidth / 2);
            const xNext = marginLeft + ((i + 1) * barWidth) + (barWidth / 2);

            return xCurrent + (relativePosition * (xNext - xCurrent));
          }
        }

        // Fallback: timestamp exactamente en la última vela
        return marginLeft + ((visibleCandles.length - 1) * barWidth) + (barWidth / 2);
      },

      xToTime: (x) => {
        const relativeX = x - marginLeft;
        const candleIndex = Math.floor(relativeX / barWidth);
        if (candleIndex < 0 || candleIndex >= visibleCandles.length) {
          return null;
        }
        return visibleCandles[candleIndex].timestamp;
      }
    };
  };

  // ==================== DRAW CHART ====================
  // 🎯 OPTIMIZACIÓN: Throttle a 30fps para reducir uso de CPU
  const FRAME_BUDGET_MS = 33; // ~30fps (1000ms / 30 = 33.3ms)

  const drawChart = (candles, livePrice = null, mouseX = null, mouseY = null, forceRender = false) => {
    if (!mountedRef.current) return;

    // 🎯 THROTTLE: Saltar frame si no ha pasado suficiente tiempo
    // Excepciones: forceRender=true, o primer render (!initialRenderDoneRef.current)
    const now = performance.now();
    const isFirstRender = !initialRenderDoneRef.current;

    if (!forceRender && !isFirstRender && now - lastRenderTimeRef.current < FRAME_BUDGET_MS) {
      // El próximo cuadro dibuja lo último pedido: si el mouse se detiene, la cruz queda en su sitio
      pendingDrawRef.current = [candles, livePrice, mouseX, mouseY];
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          drawChart(...pendingDrawRef.current, true);
        });
      }
      return;
    }
    lastRenderTimeRef.current = now;
    initialRenderDoneRef.current = true;

    const canvas = canvasRef.current;
    if (!canvas || candles.length === 0) return;

    // Lienzo opaco: el texto del gráfico sale con suavizado ClearType, como el resto de la pantalla.
    // El fondo blanco se pinta entero en cada cuadro. Con "chart_pixel_ratio" en "off" queda transparente, como antes
    const ctx = canvas.getContext("2d", { alpha: screenDensity() === null });
    const rect = canvas.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);

    if (width === 0 || height === 0) return;

    // El lienzo tiene los píxeles reales de la pantalla y se dibuja en píxeles CSS con esa escala:
    // el navegador no lo estira y se ve nítido. Una imagen de trade puede pedir otra densidad
    const density = captureDensityRef.current ?? screenDensity();
    const exact = density !== null && !captureDensityRef.current ? devicePixelsRef.current : null;
    const fits = (size, css) => size && Math.abs(size / density - css) < 1;
    const bitmapWidth = density === null ? width
      : (fits(exact?.width, rect.width) ? exact.width : Math.max(1, Math.round(rect.width * density)));
    const bitmapHeight = density === null ? height
      : (fits(exact?.height, rect.height) ? exact.height : Math.max(1, Math.round(rect.height * density)));

    if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
      canvas.width = bitmapWidth;
      canvas.height = bitmapHeight;
    }

    const scaleX = density === null ? 1 : bitmapWidth / rect.width;
    const scaleY = density === null ? 1 : bitmapHeight / rect.height;
    installCrispRects(ctx);
    installThemeFonts(ctx);
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    resetCanvasMoves(ctx);
    setCanvasPixels(scaleX, scaleY, density !== null);
    drawnSizeRef.current = { width: rect.width, height: rect.height };

    // Estilo Nítido (uiTheme.js). Con el clásico todo queda como antes
    const isNew = isNewTheme();
    const bullColor = isNew ? THEME.up : "#34C759";
    const bearColor = isNew ? THEME.down : "#FF3B30";
    const axisColor = isNew ? THEME.grid : "#DDE2E7";
    const textColor = isNew ? THEME.textMuted : "#666";

    const marginLeft = 10;
    const marginRight = 65;
    const marginTop = 25;
    const timeAxisHeight = 25;

    // 🎯 Altura del volumen ahora viene del estado (controlable por usuario)
    // const baseVolumeHeight = 50; // REMOVIDO - ahora usa volumeHeight del estado

    let desiredIndicatorsHeight = 0;
    if (indicatorManagerRef.current) {
      desiredIndicatorsHeight = indicatorManagerRef.current.getTotalHeight();
    }

    const availableHeight = height - marginTop - timeAxisHeight;

    // El precio recibe su parte primero y el resto se reparte entre volumen e indicadores.
    // Si todo cabe, lo que sobra va al precio: el gráfico llena la pantalla sin scroll.
    const priceTarget = Math.floor(availableHeight * priceChartRatio);
    const heightScale = Math.min(1, (availableHeight - priceTarget) / (volumeHeight + desiredIndicatorsHeight));

    const volumeHeightCalculated = Math.max(Math.min(volumeHeight, MIN_VOLUME_HEIGHT), Math.floor(volumeHeight * heightScale));
    let indicatorsHeight = 0;

    if (indicatorManagerRef.current) {
      indicatorManagerRef.current.setHeightScale(heightScale);
      indicatorsHeight = indicatorManagerRef.current.getScaledHeight();
    }

    const priceChartHeight = Math.max(
      Math.floor(availableHeight * 0.3),
      availableHeight - volumeHeightCalculated - indicatorsHeight
    );

    const marginBottom = volumeHeightCalculated + timeAxisHeight + indicatorsHeight;

    // En reproducción las velas se validan una vez al cargarlas, no en cada dibujo
    let displayCandles = candles;
    if (!backtestingMode || inProgressCandleRef.current) {
      displayCandles = [...candles];
      if (inProgressCandleRef.current) displayCandles.push(inProgressCandleRef.current);
      displayCandles = displayCandles.filter(isValidCandle);
    }

    const chartWidth = width - marginLeft - marginRight;
    const effectiveBarWidth = Math.max(0.1, Math.min(MAX_BAR_WIDTH, 8 * viewStateRef.current.zoom));
    const candlesPerScreen = Math.floor(chartWidth / effectiveBarWidth);
    const maxOffset = Math.max(0, displayCandles.length - candlesPerScreen);
    const offset = Math.min(viewStateRef.current.offset, maxOffset);
    
    const startIdx = Math.max(0, displayCandles.length - candlesPerScreen - offset);
    const endIdx = Math.min(displayCandles.length, startIdx + candlesPerScreen);
    const visibleCandles = displayCandles.slice(startIdx, endIdx);

    if (priceDecimalsRef.current?.symbol !== symbol && displayCandles.length) {
      priceDecimalsRef.current = { symbol, value: priceDecimals(displayCandles) };
    }
    const pxDecimals = priceDecimalsRef.current?.value ?? 2;

    ctx.fillStyle = isNew ? THEME.chartBg : "#FFFFFF";
    ctx.fillRect(0, 0, density === null ? width : rect.width, density === null ? height : rect.height);

    if (visibleCandles.length === 0) return;

    // La escala sigue las velas a la vista, también en vivo (12/11/2026, app nueva de la suite). El modo en vivo
    // de la Watchlist usaba todas las velas cargadas: con 30 días de BTC las velas quedaban aplastadas en una franja
    const candlesForPriceRange = visibleCandles;
    let minPrice = Math.min(...candlesForPriceRange.map(d => d.low));
    let maxPrice = Math.max(...candlesForPriceRange.map(d => d.high));

    // Order Flow: con velas anchas el footprint reemplaza la vela y sus niveles entran en la escala
    const orderFlowIndicator = indicatorManagerRef.current?.getOrderFlowIndicator?.();
    const orderFlowReplacesCandles = !!orderFlowIndicator?.shouldReplaceCandles(chartWidth / visibleCandles.length);
    if (orderFlowReplacesCandles) {
      const extent = orderFlowIndicator.priceExtent(visibleCandles);
      if (extent) {
        minPrice = Math.min(minPrice, extent.low);
        maxPrice = Math.max(maxPrice, extent.high);
      }
    }

    // La imagen de una orden muestra cada nivel elegido para ella: al alejar la vista podía quedar fuera del precio
    if (captureItemsRef.current?.length) {
      ({ low: minPrice, high: maxPrice } = priceRangeWith(captureItemsRef.current, minPrice, maxPrice, CAPTURE_LEVEL_ROOM_PX / priceChartHeight));
    }

    const priceRange = maxPrice - minPrice;
    const priceAreaEnd = marginTop + priceChartHeight;
    if (priceAreaEnd !== priceScaleRef.current?.priceAreaEnd) setPriceAreaBottom(priceAreaEnd);

    priceScaleRef.current = {
      minPrice, maxPrice, marginTop, marginLeft, priceChartHeight, chartWidth, startIdx,
      priceAreaEnd, availableHeight, heightScale,
      visibleCount: visibleCandles.length,
      totalCount: displayCandles.length
    };

    // 🎯 NUEVO: Aplicar zoom vertical (Ctrl + rueda del mouse) y offset vertical (paneo)
    const verticalZoom = viewStateRef.current.verticalZoom || 1;
    const verticalOffset = viewStateRef.current.verticalOffset || 0;
    const baseYScale = priceRange > 0 ? priceChartHeight / priceRange : 1;
    const yScale = baseYScale * verticalZoom;

    const maxVolume = Math.max(...visibleCandles.map(d => d.volume));
    const volumeScale = maxVolume > 0 ? volumeHeightCalculated / maxVolume : 1;

    const barWidth = chartWidth / visibleCandles.length;

    ctx.strokeStyle = axisColor;
    ctx.fillStyle = textColor;
    ctx.font = "10px Inter, sans-serif";
    ctx.lineWidth = crispWidth(1);

    if (isNew) {
      // Precios redondos con los decimales de la moneda, uno cada ~56 px, y rejilla muy suave
      const priceAt = y => minPrice + (marginTop + priceChartHeight - y + verticalOffset) / yScale;
      // Con precio oculto los pasos redondos son del índice, no del precio real
      const topPrice = maskPrice(priceAt(marginTop));
      const bottomPrice = maskPrice(priceAt(marginTop + priceChartHeight));
      const axisDecimals = pricesHidden() ? 3 : pxDecimals;
      const step = niceStep(topPrice - bottomPrice, priceChartHeight, 56, Math.pow(10, -axisDecimals));
      const first = Math.ceil(bottomPrice / step);
      ctx.font = `${THEME.fontSize}px ${THEME.font}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (let k = first; k * step <= topPrice; k++) {
        const shown = k * step;
        const price = unmaskPrice(shown);
        const y = marginTop + priceChartHeight - (price - minPrice) * yScale + verticalOffset;
        if (y < marginTop + 4 || y > marginTop + priceChartHeight - 4) continue;
        ctx.strokeStyle = THEME.grid;
        ctx.beginPath();
        ctx.moveTo(marginLeft, alignY(y));
        ctx.lineTo(width - marginRight, alignY(y));
        ctx.stroke();
        ctx.fillStyle = THEME.textMuted;
        ctx.fillText(shown.toFixed(axisDecimals), width - marginRight + 8, Math.round(y));
      }
      ctx.textBaseline = 'alphabetic';
    } else for (let i = 0; i <= 4; i++) {
      const price = minPrice + (priceRange * i / 4);
      const y = marginTop + priceChartHeight - (price - minPrice) * yScale + verticalOffset;
      const lineY = alignY(y);

      ctx.beginPath();
      ctx.moveTo(marginLeft, lineY);
      ctx.lineTo(width - marginRight, lineY);
      ctx.stroke();

      ctx.fillText(priceText(price, 2), width - marginRight + 5, y + 4);
    }

    // 🎯 DIBUJAR VELAS PRIMERO (para que los overlays se vean encima)
    ctx.lineWidth = 1;
    const crispCandles = barWidth * pixelRatio() >= 1;
    if (!orderFlowReplacesCandles) visibleCandles.forEach((d, i) => {
      const x = marginLeft + (i * barWidth);
      const yOpen = marginTop + priceChartHeight - (d.open - minPrice) * yScale + verticalOffset;
      const yClose = marginTop + priceChartHeight - (d.close - minPrice) * yScale + verticalOffset;
      const yHigh = marginTop + priceChartHeight - (d.high - minPrice) * yScale + verticalOffset;
      const yLow = marginTop + priceChartHeight - (d.low - minPrice) * yScale + verticalOffset;

      const color = d.close >= d.open ? bullColor : bearColor;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;

      // Mecha y cuerpo en píxeles reales enteros, con la mecha al centro del cuerpo.
      // Con velas más angostas que un píxel real se dibujan como siempre: miles caen en cada columna
      const columns = crispCandles ? candleColumns(x + barWidth / 2, Math.max(barWidth * 0.7, 2)) : null;
      if (columns) {
        const openCloseHeight = Math.abs(yClose - yOpen);
        const bodyTop = openCloseHeight < 2 ? (yOpen + yClose) / 2 - 1.5 : Math.min(yOpen, yClose);
        const [wickY, wickHeight] = snapSpanY(yHigh, yLow);
        const [bodyY, bodyHeightPx] = snapSpanY(bodyTop, bodyTop + (openCloseHeight < 2 ? 3 : Math.max(openCloseHeight, 2)));
        ctx.fillRect(columns.wickX, wickY, columns.wickWidth, wickHeight);
        ctx.fillRect(columns.bodyX, bodyY, columns.bodyWidth, bodyHeightPx);
        return;
      }

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

    // 🎯 ORDER FLOW: Renderizar overlays DESPUÉS de las velas (para que se vean encima)
    if (indicatorManagerRef.current) {
      const overlayBounds = {
        x: marginLeft,
        y: marginTop,
        width: chartWidth,
        height: priceChartHeight
      };

      const priceToY = (price) => {
        return marginTop + priceChartHeight - (price - minPrice) * yScale + verticalOffset;
      };

      const timeToX = (timestamp) => {
        if (!visibleCandles || visibleCandles.length === 0) return null;
        const exactIndex = timestampIndex(visibleCandles, timestamp);
        if (exactIndex !== -1) {
          return marginLeft + (exactIndex * barWidth) + (barWidth / 2);
        }
        const firstTs = visibleCandles[0].timestamp;
        const lastTs = visibleCandles[visibleCandles.length - 1].timestamp;
        const avgInterval = (lastTs - firstTs) / Math.max(1, visibleCandles.length - 1);
        if (avgInterval <= 0) return null;
        const relativeIndex = (timestamp - firstTs) / avgInterval;
        const x = marginLeft + (relativeIndex * barWidth) + (barWidth / 2);
        return x;
      };

      const newestCandle = displayCandles[displayCandles.length - 1];

      const priceContext = {
        minPrice,
        maxPrice,
        priceRange,
        verticalZoom,
        verticalOffset,
        yScale,
        priceToY,
        knownCandles: backtestingMode ? displayCandles : null, // Solo lo que ya ocurrió en la hora simulada
        knownUntil: !backtestingMode ? Date.now()
          : (newestCandle.in_progress ? newestCandle.knownUntil : simulatedNowRef.current),
        requestRedraw: () => indicatorManagerRef.current?.requestRedraw?.(),
        timeToX
      };

      const allCandlesForCalculation = backtestingMode && allCandlesRef.current && allCandlesRef.current.length > 0
        ? allCandlesRef.current
        : displayCandles;

      // Con zoom vertical los overlays no invaden los paneles de abajo
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, snapEdge(marginTop), width, snapEdge(marginTop + priceChartHeight) - snapEdge(marginTop));
      ctx.clip();
      indicatorManagerRef.current.renderOverlays(ctx, overlayBounds, visibleCandles, allCandlesForCalculation, priceContext);

      // Lo elegido en otro marco va en la vela de este marco que contiene su hora
      const candleX = (timestamp) => candleCenterX(visibleCandles, TF_MS[interval], marginLeft, barWidth, timestamp) ?? timeToX(timestamp);
      const area = { priceToY, timeToX, candleX, left: marginLeft, right: marginLeft + chartWidth, top: marginTop, bottom: marginTop + priceChartHeight };
      // Al tomar la imagen de una orden, lo elegido para ella
      const chosen = captureItemsRef.current ?? knownLevels(symbol, simulatedNowRef.current ?? priceContext.knownUntil);
      drawChosenLevels(ctx, chosen, area);
      ctx.restore();

      // Los footprints van encima de los perfiles y demás indicadores, para leer sus cifras
      orderFlowIndicator?.renderOnChart(ctx, overlayBounds, visibleCandles, priceContext, orderFlowReplacesCandles);

      // Lo que se puede elegir con un clic, ya ubicado por los indicadores en este cuadro. No se dibuja nada más
      // Lo de los paneles queda bajo el precio: se ofrece aunque esté fuera del área de las velas
      const offered = indicatorManagerRef.current.getSelectableLevels().filter(target => target.panel || withinArea(target, area));
      const positions = itemPositions(chosen, offered, area);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, snapEdge(marginTop), width, snapEdge(marginTop + priceChartHeight) - snapEdge(marginTop));
      ctx.clip();
      drawChosenMarks(ctx, positions);
      drawFocusMark(ctx, area);
      ctx.restore();

      const chosenTargets = [
        ...chosen.filter(item => !item.mark),
        ...positions.filter(({ item }) => item.mark).map(({ item, x, y }) => ({ ...item, x, y, r: 10 }))
      ];
      const shownIds = new Set();
      levelTargetsRef.current = levelTargets([...chosenTargets, ...offered], area)
        .filter(level => !shownIds.has(level.id) && shownIds.add(level.id));
      lastAreaRef.current = { area, offered };
    }

    // 🎯 NUEVO: Calcular z-score de volúmenes para mejoras visuales
    const volumes = visibleCandles.map(d => d.volume);
    const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    const stdDevVolume = Math.sqrt(
      volumes.reduce((sum, v) => sum + Math.pow(v - avgVolume, 2), 0) / volumes.length
    );

    // Calcular z-score para cada vela
    const volumeZScores = visibleCandles.map(d => {
      if (stdDevVolume === 0) return 0;
      return (d.volume - avgVolume) / stdDevVolume;
    });

    const volumeStartY = marginTop + priceChartHeight + 5;

    // 🎯 NUEVO: Detectar clusters de volumen alto consecutivo
    // 🔧 FIX: Validar que los parámetros existen (para estados guardados antiguos)
    const clusterIndices = new Set(); // Set de índices que forman parte de un cluster
    const clusterDirections = new Map(); // Map: índice -> 'bullish' | 'bearish'

    if (volumeVisualParams.clusterDetection === true &&
        typeof volumeVisualParams.clusterMinBars !== 'undefined' &&
        typeof volumeVisualParams.clusterThreshold !== 'undefined') {
      const clusters = [];
      let currentCluster = null;

      volumeZScores.forEach((zScore, i) => {
        // Si el z-score está por encima del umbral, es parte de un posible cluster
        if (zScore >= volumeVisualParams.clusterThreshold) {
          if (!currentCluster) {
            // Iniciar nuevo cluster
            currentCluster = { start: i, end: i, avgZScore: zScore, count: 1 };
          } else {
            // Extender cluster existente
            currentCluster.end = i;
            currentCluster.avgZScore = (currentCluster.avgZScore * currentCluster.count + zScore) / (currentCluster.count + 1);
            currentCluster.count++;
          }
        } else {
          // Finalizar cluster si existe
          if (currentCluster && currentCluster.count >= volumeVisualParams.clusterMinBars) {
            clusters.push(currentCluster);
          }
          currentCluster = null;
        }
      });

      // No olvidar el último cluster si quedó abierto
      if (currentCluster && currentCluster.count >= volumeVisualParams.clusterMinBars) {
        clusters.push(currentCluster);
      }

      // 🎯 NUEVO: Guardar índices y direcciones de barras que forman parte de clusters
      clusters.forEach(cluster => {
        // Determinar dirección del cluster: comparar precio de apertura del inicio con precio de cierre del final
        const firstCandle = visibleCandles[cluster.start];
        const lastCandle = visibleCandles[cluster.end];
        const direction = lastCandle.close >= firstCandle.open ? 'bullish' : 'bearish';

        for (let i = cluster.start; i <= cluster.end; i++) {
          clusterIndices.add(i);
          clusterDirections.set(i, direction);
        }
      });
    }

    // Con Nítido, lo que el usuario cambió en el modal del volumen gana: la intensidad, la opacidad, el
    // degradado o el brillo vuelven al dibujo con degradado, y los colores de cluster elegidos se respetan
    const volumeLookCustom = isNew && VOLUME_LOOK_KEYS.some(key => volumeVisualParams[key] !== VOLUME_VISUAL_DEFAULTS[key]);
    const clusterColorBull = isNew && volumeVisualParams.clusterColorBullish === VOLUME_VISUAL_DEFAULTS.clusterColorBullish
      ? THEME.up : volumeVisualParams.clusterColorBullish;
    const clusterColorBear = isNew && volumeVisualParams.clusterColorBearish === VOLUME_VISUAL_DEFAULTS.clusterColorBearish
      ? THEME.down : volumeVisualParams.clusterColorBearish;

    // 🎯 Renderizar volumen con mejoras visuales basadas en z-score
    if (isNew && !volumeLookCustom) {
      // Barras planas del color de la vela, sin brillo: el volumen alto se nota por la altura y un poco más de tinta
      const clusterBullRgb = rgbOf(clusterColorBull) || THEME.upRgb;
      const clusterBearRgb = rgbOf(clusterColorBear) || THEME.downRgb;
      visibleCandles.forEach((d, i) => {
        const x = marginLeft + (i * barWidth);
        const volHeight = d.volume * volumeScale;
        const inCluster = clusterIndices.has(i);
        const rgb = inCluster
          ? (clusterDirections.get(i) === 'bullish' ? clusterBullRgb : clusterBearRgb)
          : (d.close >= d.open ? THEME.upRgb : THEME.downRgb);
        const alpha = inCluster ? 0.7 : 0.3 + 0.32 * Math.max(0, Math.min(1, (volumeZScores[i] + 1) / 4));
        ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
        ctx.fillRect(x + barWidth * 0.15, volumeStartY + volumeHeightCalculated - volHeight, barWidth * 0.7, volHeight);
      });
    } else visibleCandles.forEach((d, i) => {
      const x = marginLeft + (i * barWidth);
      const volHeight = d.volume * volumeScale;
      const zScore = volumeZScores[i];

      // 🎯 NUEVO: Determinar color base - si está en un cluster, usar color según dirección
      const isInCluster = clusterIndices.has(i);
      let baseColor;

      if (isInCluster) {
        const direction = clusterDirections.get(i);
        baseColor = direction === 'bullish' ? clusterColorBull : clusterColorBear;
      } else {
        baseColor = d.close >= d.open ? bullColor : bearColor;
      }

      // 🎯 Intensidad basada en z-score (normalizada a 0-1)
      // Usa parámetros configurables del estado
      const intensity = Math.max(
        volumeVisualParams.intensityMin,
        Math.min(volumeVisualParams.intensityMax, (zScore + 1) / volumeVisualParams.intensityDivisor)
      );

      // 🎯 Opacidad adaptativa: más opaco para volúmenes altos
      // Usa parámetros configurables del estado
      ctx.globalAlpha = Math.max(
        volumeVisualParams.opacityMin,
        Math.min(volumeVisualParams.opacityMax, volumeVisualParams.opacityBase + (zScore / volumeVisualParams.opacityDivisor))
      );

      // 🎯 Gradiente de color según intensidad
      // Interpolar entre el color base más oscuro y el color base
      const gradient = ctx.createLinearGradient(x, volumeStartY + volumeHeightCalculated - volHeight, x, volumeStartY + volumeHeightCalculated);

      // Extraer RGB del color hex
      const r = parseInt(baseColor.slice(1, 3), 16);
      const g = parseInt(baseColor.slice(3, 5), 16);
      const b = parseInt(baseColor.slice(5, 7), 16);

      // Color superior más intenso, color inferior más suave
      // Usa parámetro configurable para el multiplicador del gradiente inferior
      gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${intensity})`);
      gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${intensity * volumeVisualParams.gradientBottomMultiplier})`);

      ctx.fillStyle = gradient;
      ctx.fillRect(x + barWidth * 0.1, volumeStartY + volumeHeightCalculated - volHeight, barWidth * 0.8, volHeight);

      // 🎯 Glow effect para volúmenes excepcionales (solo si NO está en cluster)
      // Los clusters tienen su propio color destacado, no necesitan glow adicional
      if (!isInCluster && zScore > volumeVisualParams.glowThreshold) {
        ctx.shadowBlur = volumeVisualParams.glowBlur * pixelRatio(); // La sombra no sigue la escala del lienzo
        ctx.shadowColor = baseColor;
        ctx.fillStyle = baseColor;
        ctx.fillRect(x + barWidth * 0.1, volumeStartY + volumeHeightCalculated - volHeight, barWidth * 0.8, volHeight);
        ctx.shadowBlur = 0; // Resetear shadow
      }
    });

    ctx.globalAlpha = 1.0;

    ctx.fillStyle = textColor;
    ctx.font = "9px Inter, sans-serif";
    ctx.fillText("Vol", marginLeft + 2, volumeStartY + 12);

    // Cada barra de volumen se puede incluir en el análisis, como marca en su vela
    if (barWidth >= 3 && avgVolume > 0 && levelTargetsRef.current) {
      const volumeTargets = [];
      visibleCandles.forEach((d, i) => {
        if (d.in_progress) return;
        const left = marginLeft + i * barWidth;
        const cluster = clusterIndices.has(i) ? ` · cluster ${clusterDirections.get(i) === 'bullish' ? 'alcista' : 'bajista'}` : '';
        volumeTargets.push({
          id: candleItemId('Volumen', 'barra', d.timestamp, null, interval),
          source: 'Volumen', kind: `Volumen ${(d.volume / avgVolume).toFixed(1)}x la media a la vista${cluster}`,
          price: d.close, time: d.timestamp, mark: true, panel: true, volumeBar: true,
          left, right: left + barWidth, top: volumeStartY + 14, bottom: volumeStartY + volumeHeightCalculated
        });
      });
      levelTargetsRef.current = [...levelTargetsRef.current.filter(target => !target.volumeBar), ...volumeTargets];
    }

    const timeStep = Math.max(Math.floor(visibleCandles.length / 5), 1);
    const timeY = volumeStartY + volumeHeightCalculated + 15;

    ctx.fillStyle = textColor;
    ctx.font = "10px Inter, sans-serif";

    if (isNew) {
      // Horas redondas en hora de Colombia, separadas al menos 90 px; el cambio de día en negrita
      const candleMs = TF_MS[interval] || Math.max(60000, (visibleCandles[1]?.timestamp ?? 60000) - visibleCandles[0].timestamp);
      const step = niceTimeStep(barWidth, candleMs, 90);
      ctx.textAlign = 'center';
      let lastRight = -Infinity;
      for (let i = 0; i < visibleCandles.length; i++) {
        const timestamp = visibleCandles[i].timestamp;
        if (!isTimeTick(timestamp, step)) continue;
        let { text, strong } = timeTick(timestamp, step);
        if (isBlind()) {
          const [word, day, clock] = maskDate(timestamp).split(' ');
          text = strong ? `${word} ${day}` : clock;
        }
        ctx.font = `${strong ? '600 ' : ''}${THEME.fontSize}px ${THEME.font}`;
        const x = marginLeft + (i * barWidth) + (barWidth / 2);
        const half = ctx.measureText(text).width / 2;
        if (x - half < lastRight + 10 || x - half < 2) continue;
        ctx.fillStyle = strong ? THEME.text : THEME.textMuted;
        ctx.fillText(text, x, timeY);
        lastRight = x + half;
      }
      ctx.textAlign = 'left';
    } else for (let i = 0; i < visibleCandles.length; i += timeStep) {
      const candle = visibleCandles[i];
      const prevCandle = i > 0 ? visibleCandles[i - timeStep] : null;
      const x = marginLeft + (i * barWidth) + (barWidth / 2);
      
      const timeText = isBlind() ? maskDate(candle.timestamp) : formatAxisTime(
        candle.datetime_colombia || colombiaTime(candle.timestamp),
        prevCandle && (prevCandle.datetime_colombia || colombiaTime(prevCandle.timestamp))
      );
      const textWidth = ctx.measureText(timeText).width;
      ctx.fillText(timeText, Math.max(2, x - textWidth / 2), timeY);
    }

    if (isNew) {
      // Leyenda: moneda y marco, y apertura, máximo, mínimo, cierre y volumen de la vela bajo la cruz (o la última)
      let legendCandle = visibleCandles[visibleCandles.length - 1];
      if (mouseX !== null && mouseX >= marginLeft && mouseX <= width - marginRight) {
        const index = Math.floor((mouseX - marginLeft) / barWidth);
        if (index >= 0 && index < visibleCandles.length) legendCandle = visibleCandles[index];
      }
      const rising = legendCandle.close >= legendCandle.open;
      const valueColor = rising ? THEME.upText : THEME.downText;
      const legendY = 17;
      let legendX = marginLeft + 4;
      const put = (text, color, font, gap) => {
        ctx.font = font;
        ctx.fillStyle = color;
        ctx.fillText(text, legendX, legendY);
        legendX += ctx.measureText(text).width + gap;
      };
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      put(`${symbol} · ${interval}`, THEME.text, `600 13px ${THEME.font}`, 16);
      const small = `${THEME.fontSize}px ${THEME.font}`;
      for (const [label, value] of [['O', legendCandle.open], ['H', legendCandle.high], ['L', legendCandle.low], ['C', legendCandle.close]]) {
        put(label, THEME.textMuted, small, 3);
        put(priceText(value, pxDecimals), valueColor, small, 10);
      }
      const change = legendCandle.open ? ((legendCandle.close - legendCandle.open) / legendCandle.open) * 100 : 0;
      put(`${change >= 0 ? '+' : ''}${change.toFixed(2)}%`, valueColor, small, 14);
      const rawVolume = legendCandle.volume || 0;
      const volume = maskVolume(rawVolume);
      const volumeText = volume >= 1e6 ? `${(volume / 1e6).toFixed(2)}M` : volume >= 1e4 ? `${(volume / 1e3).toFixed(1)}K` : volume.toFixed(volume >= 100 ? 0 : 1);
      put('V', THEME.textMuted, small, 3);
      put(volumeText, THEME.text, small, 0);
    } else {
    ctx.fillStyle = "#222";
    ctx.font = "bold 13px Inter, sans-serif";
    ctx.fillText(symbol, marginLeft + 5, 18);

    ctx.fillStyle = "#666";
    ctx.font = "10px Inter, sans-serif";
    // El total de velas dejaría calcular la fecha oculta
    const candleInfo = isBlind() ? `${visibleCandles.length} velas` : `${visibleCandles.length}/${displayCandles.length} velas`;
    ctx.fillText(candleInfo, marginLeft + 80, 18);

    // 🎯 NUEVO: Mostrar timeframe en la esquina superior derecha
    ctx.fillStyle = "#2196F3";
    ctx.font = "bold 14px Inter, sans-serif";
    const timeframeText = interval;
    const timeframeWidth = ctx.measureText(timeframeText).width;
    ctx.fillRect(width - marginRight - timeframeWidth - 16, 6, timeframeWidth + 12, 20);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(timeframeText, width - marginRight - timeframeWidth - 10, 20);
    }

    if (indicatorManagerRef.current) {
      const indicatorsBounds = {
        x: marginLeft,
        y: marginTop + priceChartHeight + volumeHeightCalculated + timeAxisHeight,
        width: chartWidth,
        height: indicatorsHeight
      };
      if (indicatorsHeight > 0) indicatorManagerRef.current.renderIndicators(ctx, indicatorsBounds, visibleCandles);

      const rects = indicatorManagerRef.current.getPanelRects(indicatorsBounds.y);
      const rectsKey = JSON.stringify(rects);
      if (rectsKey !== panelsKeyRef.current) {
        panelsKeyRef.current = rectsKey;
        setPanels(rects);
      }
    }

    // 🎯 NUEVO: Renderizar dibujos (DESPUÉS de velas, ANTES de crosshair)
    // Añadir verificaciones defensivas para evitar crashes durante playback
    if (drawingManagerRef.current && visibleCandles && visibleCandles.length > 0 &&
        typeof minPrice === 'number' && typeof yScale === 'number' && typeof verticalOffset === 'number') {
      try {
        // Crear scale converter usando función centralizada
        const scaleConverter = createScaleConverter(
          visibleCandles, displayCandles, minPrice, maxPrice, yScale, verticalOffset,
          chartWidth, priceChartHeight, marginLeft, marginTop, barWidth
        );

        // Guardar en ref para que los eventos de mouse lo usen
        scaleConverterRef.current = scaleConverter;

        if (scaleConverter) {
          drawingManagerRef.current.render(ctx, scaleConverter);

          // Renderizar herramienta de medición
          if (measurementToolRef.current) {
            measurementToolRef.current.render(ctx, scaleConverter);
          }
        }
      } catch (error) {
        console.error(`[${symbol}] Error rendering drawings:`, error);
        // No propagar el error para evitar crash de la aplicación
      }
    }

    // Cajas TP/SL de los trades que llegan de afuera (el 2.º gráfico no tiene los dibujos de la principal)
    const tradeBoxes = getTradeBoxes?.() || [];
    if (tradeBoxes.length > 0 && scaleConverterRef.current) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(marginLeft, marginTop, chartWidth, priceChartHeight);
      ctx.clip();
      // Solo las cajas que tocan las velas a la vista: con muchos trades, armar y dibujar todas en cada cuadro pesa
      const viewStart = visibleCandles[0]?.timestamp ?? -Infinity;
      const viewEnd = (visibleCandles[visibleCandles.length - 1]?.timestamp ?? Infinity) + TF_MS[interval];
      for (const trade of tradeBoxes) {
        if (!Number.isFinite(trade.entry) || !Number.isFinite(trade.start)) continue;
        const end = Number.isFinite(trade.end) ? trade.end : (simulatedNowRef.current ?? trade.start);
        const timeEnd = Math.max(end, trade.start + TF_MS[interval]);
        if (timeEnd < viewStart || trade.start > viewEnd) continue;
        const box = new TPSLBox(trade.entry, trade.start, trade.side === 'short' ? 'short' : 'long', { timeStart: trade.start, timeEnd });
        box.slPrice = Number.isFinite(trade.stop) ? trade.stop : trade.entry;
        box.tpPrice = Number.isFinite(trade.target) ? trade.target : trade.entry;
        try {
          box.render(ctx, scaleConverterRef.current);
        } catch (error) {
          // Una caja que no se puede ubicar en este marco no detiene el dibujo
        }
      }
      ctx.restore();
    }

    // Posiciones y órdenes reales (suite en vivo): entrada con P&L al último precio, SL, TP, liquidación y entradas pendientes
    positionTargetsRef.current = [];
    const positionLines = getPositionLines?.() || [];
    if (positionLines.length > 0 && scaleConverterRef.current) {
      try {
        const lastClose = displayCandles[displayCandles.length - 1]?.close;
        positionPriceRef.current = Number.isFinite(lastClose) ? lastClose : livePrice;
        positionTargetsRef.current = drawPositionLines(ctx, positionLines, {
          priceToY: scaleConverterRef.current.priceToY,
          left: marginLeft, right: width - marginRight, top: marginTop, bottom: marginTop + priceChartHeight, axisRight: width,
          lastPrice: positionPriceRef.current,
          fmt: (price) => priceText(price, pxDecimals),
          drag: positionDragRef.current,
        });
      } catch (error) {
        console.error(`[${symbol}] Error dibujando posiciones:`, error);
      }
    }

    // 🎯 Líneas verticales de todos los trades. Salen de las órdenes, que son lo que guarda la sesión
    const tradeLines = getTradeBoundaries?.() || [];
    if (tradeLines.length > 0 && scaleConverterRef.current) {
      const scaleConverter = scaleConverterRef.current;

      // Un trade abierto justo al iniciar una vela cae a la derecha de la última: se marca en el borde
      const rightEdge = width - marginRight;
      const tradeX = (time) => {
        const x = scaleConverter.timeToX(time);
        return x > rightEdge && x <= rightEdge + barWidth ? rightEdge : x;
      };

      tradeLines.forEach(({ entryTime, exitTime, tradeNumber }) => {
        try {
          // Convertir timestamps a coordenadas X
          const entryX = tradeX(entryTime);
          const exitX = exitTime ? tradeX(exitTime) : null;

          // Solo dibujar si al menos una línea está visible
          if ((entryX >= marginLeft && entryX <= width - marginRight) ||
              (exitX && exitX >= marginLeft && exitX <= width - marginRight)) {

            // Estilo para las líneas verticales
            ctx.strokeStyle = '#FF9800'; // Naranja
            ctx.lineWidth = crispWidth(2, 'x');
            ctx.setLineDash([5, 3]); // Línea punteada

            // Línea vertical en entry time (siempre existe)
            if (entryX >= marginLeft && entryX <= width - marginRight) {
              ctx.beginPath();
              ctx.moveTo(alignX(entryX, 2), marginTop);
              ctx.lineTo(alignX(entryX, 2), marginTop + priceChartHeight);
              ctx.stroke();
            }

            // Línea vertical en exit time (solo si el trade está cerrado)
            if (exitX && exitX >= marginLeft && exitX <= width - marginRight) {
              ctx.beginPath();
              ctx.moveTo(alignX(exitX, 2), marginTop);
              ctx.lineTo(alignX(exitX, 2), marginTop + priceChartHeight);
              ctx.stroke();
            }

            ctx.setLineDash([]); // Resetear línea punteada

            // Dibujar número del trade en la esquina superior izquierda (junto a la línea de entry)
            if (entryX >= marginLeft && entryX <= width - marginRight) {
              ctx.font = 'bold 16px sans-serif';
              ctx.fillStyle = '#FF9800';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'top';

              const tradeLabel = `#${tradeNumber}`;
              const labelX = Math.max(marginLeft + 5, entryX + 5); // 5px a la derecha de la línea
              const labelY = marginTop + 5; // 5px desde el top

              // Fondo semitransparente para mejor legibilidad
              const textMetrics = ctx.measureText(tradeLabel);
              const padding = 4;
              ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
              ctx.fillRect(
                labelX - padding,
                labelY - padding,
                textMetrics.width + padding * 2,
                16 + padding * 2
              );

              // Texto
              ctx.fillStyle = '#FF9800';
              ctx.fillText(tradeLabel, labelX, labelY);
            }
          }
        } catch (error) {
          console.error(`[${symbol}] Error rendering trade #${tradeNumber}:`, error);
        }
      });
    }

    // Nítido: último precio en el eje, del color de la vela, con una línea punteada
    if (isNew) {
      const lastCandle = displayCandles[displayCandles.length - 1];
      const lastY = Math.round(marginTop + priceChartHeight - (lastCandle.close - minPrice) * yScale + verticalOffset);
      if (lastY >= marginTop && lastY <= marginTop + priceChartHeight) {
        const color = lastCandle.close >= lastCandle.open ? THEME.up : THEME.down;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = crispWidth(1);
        ctx.setLineDash([1, 2]);
        ctx.beginPath();
        ctx.moveTo(marginLeft, alignY(lastY));
        ctx.lineTo(width - marginRight, alignY(lastY));
        ctx.stroke();
        ctx.restore();

        const tagX = width - marginRight + 1;
        const tagRight = width - 1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(tagX, lastY);
        ctx.lineTo(tagX + 6, lastY - 9);
        ctx.lineTo(tagRight, lastY - 9);
        ctx.lineTo(tagRight, lastY + 9);
        ctx.lineTo(tagX + 6, lastY + 9);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `600 ${THEME.fontSize}px ${THEME.font}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(priceText(lastCandle.close, pxDecimals), tagX + 8, lastY);
        ctx.textBaseline = 'alphabetic';
      }
    }

    // 🎯 NUEVO: Crosshair estilo TradingView - mostrar info en los ejes
    if (mouseX !== null && mouseY !== null && isNew) {
      // Nítido: cruz fina y etiquetas en los ejes con la misma letra
      ctx.save();
      ctx.strokeStyle = THEME.crosshair;
      ctx.lineWidth = crispWidth(1);
      ctx.setLineDash([4, 4]);
      if (mouseX >= marginLeft && mouseX <= width - marginRight) {
        ctx.beginPath();
        ctx.moveTo(alignX(mouseX), marginTop);
        ctx.lineTo(alignX(mouseX), height - timeAxisHeight);
        ctx.stroke();
      }
      if (mouseY >= marginTop && mouseY <= marginTop + priceChartHeight) {
        ctx.beginPath();
        ctx.moveTo(marginLeft, alignY(mouseY));
        ctx.lineTo(width - marginRight, alignY(mouseY));
        ctx.stroke();
      }
      ctx.restore();
      ctx.font = `600 ${THEME.fontSize}px ${THEME.font}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      if (mouseX >= marginLeft && mouseX <= width - marginRight && visibleCandles.length > 0) {
        const index = Math.max(0, Math.min(visibleCandles.length - 1, Math.floor((mouseX - marginLeft) / barWidth)));
        const stamp = visibleCandles[index].timestamp;
        const dateText = isBlind() ? maskDate(stamp) : crossTime(stamp);
        const textWidth = ctx.measureText(dateText).width;
        const boxX = Math.round(Math.max(marginLeft, Math.min(width - marginRight - textWidth - 12, mouseX - textWidth / 2 - 6)));
        const boxY = Math.round(height - timeAxisHeight + 3);
        ctx.fillStyle = THEME.tagBg;
        ctx.fillRect(boxX, boxY, Math.round(textWidth + 12), 18);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(dateText, boxX + 6, boxY + 9);
      }
      if (mouseY >= marginTop && mouseY <= marginTop + priceChartHeight) {
        const price = minPrice + ((marginTop + priceChartHeight - mouseY + verticalOffset) / yScale);
        const boxY = Math.round(mouseY) - 9;
        ctx.fillStyle = THEME.tagBg;
        ctx.fillRect(width - marginRight + 1, boxY, marginRight - 2, 18);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(priceText(price, pxDecimals), width - marginRight + 8, boxY + 9);
      }
      ctx.textBaseline = 'alphabetic';
    } else if (mouseX !== null && mouseY !== null) {
      // Línea vertical del crosshair
      if (mouseX >= marginLeft && mouseX <= width - marginRight) {
        ctx.strokeStyle = "#999";
        ctx.lineWidth = crispWidth(2, 'x'); // Más grueso para mejor visibilidad
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(alignX(mouseX, 2), marginTop);
        ctx.lineTo(alignX(mouseX, 2), height - timeAxisHeight);
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
          const dateText = isBlind() ? maskDate(interpolatedTimestamp) : `${day} ${month} ${hours}:${minutes}`;

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

        ctx.strokeStyle = "#999";
        ctx.lineWidth = crispWidth(2); // Más grueso para mejor visibilidad
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(marginLeft, alignY(mouseY, 2));
        ctx.lineTo(width - marginRight, alignY(mouseY, 2));
        ctx.stroke();
        ctx.setLineDash([]);

        // Mostrar precio en el eje Y (derecha) - siempre visible
        ctx.fillStyle = "#333";
        ctx.fillRect(width - marginRight + 2, mouseY - 10, 58, 20);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 11px Inter, sans-serif";
        ctx.fillText(priceText(price, 2), width - marginRight + 6, mouseY + 4);
      }
    }
  };

  // ==================== DRAWING PERSISTENCE ====================

  // Línea y aro en el punto al que se fue desde una imagen
  const drawFocusMark = (ctx, { priceToY, timeToX, top, bottom, left, right }) => {
    const focus = focusMarkRef.current;
    if (!focus || performance.now() > focus.until) return;
    const x = timeToX(focus.time);
    if (x === null || x < left || x > right) return;

    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = crispWidth(2, 'x');
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(alignX(x, 2), top);
    ctx.lineTo(alignX(x, 2), bottom);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    if (Number.isFinite(focus.price)) {
      ctx.beginPath();
      ctx.arc(x, priceToY(focus.price), 12, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  // Encuadra desde una hora hasta la vela más reciente, con velas anteriores como contexto
  const frameChartFrom = (time) => {
    const candles = candlesRef.current;
    const chartWidth = priceScaleRef.current?.chartWidth;
    if (!candles?.length || !chartWidth) return;

    const first = candles.findIndex(candle => candle.timestamp >= time);
    const needed = candlesToFrame(first < 0 ? 1 : candles.length - first);
    const view = viewStateRef.current;
    const barWidth = Math.max(0.1, Math.min(MAX_BAR_WIDTH, 8 * view.zoom));

    view.offset = 0;
    view.verticalZoom = 1;
    view.verticalOffset = 0;
    if (needed > Math.floor(chartWidth / barWidth)) view.zoom = chartWidth / (needed * 8);
  };

  // Aleja la vista para una imagen con contexto: la vela de la derecha queda en su lugar y el precio se ajusta solo
  const widenChart = () => {
    const view = viewStateRef.current;
    view.zoom = contextBarWidth(Math.max(0.1, Math.min(MAX_BAR_WIDTH, 8 * view.zoom))) / 8;
    view.verticalZoom = 1;
    view.verticalOffset = 0;
  };

  // La imagen de una orden alcanza la vela de cada marca elegida para ella y el inicio de cada nivel, sin
  // perder lo que ya mostraba. Un nivel más viejo no la aleja: su línea se ve desde el borde izquierdo
  const frameItems = (items) => {
    const candles = candlesRef.current;
    const chartWidth = priceScaleRef.current?.chartWidth;
    const { first, last } = framedTimes(items);
    if ((first === null && last === null) || !candles?.length || !chartWidth) return false;

    // Una hora anterior a las velas cargadas no se puede mostrar
    const indexOf = (time) => {
      const index = time === null ? -1 : countBefore(candles, time + 1) - 1;
      return index < 0 ? null : index;
    };
    const view = viewStateRef.current;
    const perScreen = Math.floor(chartWidth / Math.max(0.1, Math.min(MAX_BAR_WIDTH, 8 * view.zoom)));
    const room = CAPTURE_MARK_ROOM_PX / Math.max(1, chartWidth - CAPTURE_MARK_ROOM_PX);
    const span = viewIncluding({ length: candles.length, perScreen, offset: view.offset }, indexOf(first), indexOf(last), room);
    if (!span) return false;

    view.offset = span.offset;
    if (span.count > perScreen) view.zoom = chartWidth / (span.count * 8);
    view.verticalZoom = 1;
    view.verticalOffset = 0;
    return true;
  };

  // Extraer rectángulos del DrawingToolManager para el modal VP Fixed
  drawChartRef.current = drawChart;

  // Al cambiar el estilo o un color se redibuja al instante
  useEffect(() => {
    if (candlesRef.current?.length > 0) {
      drawChartRef.current?.(candlesRef.current, lastPriceRef.current, null, null, true);
    }
  }, [uiTheme]);

  // Redibujar al cambiar el tamaño de la ventana, del panel lateral o de la pestaña visible
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;

    // También avisa si cambia la densidad: zoom del navegador o la ventana pasa a otro monitor
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.devicePixelContentBoxSize?.[0];
      devicePixelsRef.current = box ? { width: box.inlineSize, height: box.blockSize } : null;
      if (candlesRef.current?.length > 0) {
        drawChartRef.current?.(candlesRef.current, lastPriceRef.current, null, null);
      }
    });
    try {
      observer.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      observer.observe(canvas);
    }
    return () => observer.disconnect();
  }, []);

  // Un nivel elegido o quitado en otro marco o en el panel de órdenes se ve de una vez
  useEffect(() => subscribeLevels(symbol, () => {
    setLevelVersion(version => version + 1);
    if (candlesRef.current?.length > 0) drawChartRef.current?.(candlesRef.current, lastPriceRef.current, null, null);
  }), [symbol]);

  // Igual con una vela fijada de Liquidaciones, también al soltarla desde su modal
  useEffect(() => subscribePins(symbol, () => {
    setLevelVersion(version => version + 1);
    if (candlesRef.current?.length > 0) drawChartRef.current?.(candlesRef.current, lastPriceRef.current, null, null);
  }), [symbol]);

  // Al mover los divisores, el reparto de altura se ve mientras se arrastra
  useEffect(() => {
    if (candlesRef.current?.length > 0) {
      drawChartRef.current?.(candlesRef.current, lastPriceRef.current, null, null);
    }
  }, [priceChartRatio, volumeHeight, panelVersion]);

  const updateChartRectangles = () => {
    if (!drawingManagerRef.current) return;
    const shapes = drawingManagerRef.current.getShapes();
    const rects = shapes.filter(s => s && s.type === 'rectangle');
    setChartRectangles(rects);
  };

  const loadDrawings = async () => {
    if (!drawingManagerRef.current) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/drawings/${symbol}`);
      const data = await response.json();

      if (data.shapes && data.shapes.length > 0) {
        drawingManagerRef.current.loadShapes(data.shapes);
        console.log(`[${symbol}] ✅ Cargados ${data.shapes.length} dibujos`);
        updateChartRectangles();

        // Forzar redibujado
        if (candlesRef.current.length > 0) {
          drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
        }
      }
    } catch (error) {
      console.error(`[${symbol}] ❌ Error cargando dibujos:`, error);
    }
  };

  const saveDrawings = async () => {
    if (!drawingManagerRef.current) return;

    try {
      const shapes = drawingManagerRef.current.getShapes();

      // 🔧 FIX: En modo backtesting, solo sincronizar (no guardar al backend)
      if (backtestingMode) {
        if (onDrawingsChange) {
          onDrawingsChange(shapes, interval);
        }
        console.log(`[${symbol} ${interval}] 🔄 Sincronizados ${shapes.length} dibujos`);
        return;
      }

      // Modo normal: guardar al backend
      await fetch(`${API_BASE_URL}/api/drawings/${symbol}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interval: interval,
          shapes: shapes
        })
      });

      console.log(`[${symbol}] ✅ Guardados ${shapes.length} dibujos`);
      updateChartRectangles();
      // En vivo (suite): los demás marcos y la otra pestaña reciben los mismos dibujos. App 1 no usa este modo
      if (onDrawingsChange) {
        onDrawingsChange(shapes, interval);
      }
    } catch (error) {
      console.error(`[${symbol}] ❌ Error guardando dibujos:`, error);
    }
  };

  // ==================== DATA LOADING ====================

  const loadHistoricalData = async () => {
    try {
      const timestamp = Date.now();
      const url = `${API_BASE_URL}/api/historical/${symbol}?interval=${interval}&days=${days}&t=${timestamp}`;
      
      log.candle(symbol, `Solicitando histórico: ${days} días @ ${interval}`);
      
      const res = await fetch(url, {
        cache: 'no-cache',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      const json = await res.json();
      
      if (json.success && json.data && json.data.length > 0) {
        let historicalCandles = json.data;
        
        const now = Date.now();
        const lastCandle = historicalCandles[historicalCandles.length - 1];
        const intervalMs = getIntervalMilliseconds(interval);
        const currentTimeframeStart = Math.floor(now / intervalMs) * intervalMs;
        
        if (lastCandle.timestamp >= currentTimeframeStart) {
          log.candle(symbol, '⚠️ ÚLTIMA VELA DEL HISTÓRICO ESTÁ EN PROGRESO - Removiendo', {
            timestamp: lastCandle.timestamp,
            datetime: lastCandle.datetime_colombia
          });
          
          historicalCandles = historicalCandles.slice(0, -1);
        }
        
        candlesRef.current = historicalCandles;
        log.candle(symbol, `✅ Histórico cargado: ${historicalCandles.length} velas confirmadas`);
        log.state(symbol, candlesRef.current.length, inProgressCandleRef.current !== null);
        
        // ✅ NUEVO: Verificar si hay gap después de cargar
        if (indicatorManagerRef.current) {
          setTimeout(() => {
            indicatorManagerRef.current.checkAndRefreshIfNeeded(candlesRef.current);
          }, 1000);
        }

        // 🎯 NUEVO: Analizar rangos de consolidación
        if (indicatorManagerRef.current && indicatorManagerRef.current.isRangeDetectionEnabled()) {
          log.candle(symbol, `🔍 Range Detection habilitado - programando análisis en 1.5s`);
          setTimeout(() => {
            log.candle(symbol, `🚀 Ejecutando analyzeRanges() con ${candlesRef.current.length} velas`);
            indicatorManagerRef.current.analyzeRanges(candlesRef.current);
          }, 1500);
        } else {
          log.candle(symbol, `⏸️ Range Detection NO habilitado o indicatorManager no existe`);
        }

        drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
      } else {
        log.error(symbol, 'Error en respuesta histórica', json);
      }
    } catch (err) {
      log.error(symbol, 'Error cargando histórico', err);
    }
  };

  // ==================== WEBSOCKET HANDLER ====================
  
  const handleWebSocketMessage = (data) => {
    if (!mountedRef.current) return;

    if (data.topic && data.topic.startsWith("tickers.")) {
      const tickerData = data.data;
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
    
    if (data.topic && data.topic.startsWith("kline.")) {
      // Solo las velas de este marco: una de otro marco se colaba como vela nueva
      if (data.topic !== `kline.${getBybitInterval(interval)}.${symbol}`) return;
      const klineData = data.data;
      if (klineData && klineData.length > 0) {
        const candle = klineData[0];
        const candleTimestamp = parseInt(candle.start);
        // Una vela anterior a la ultima confirmada no se agrega al final; la misma vela solo se corrige
        const lastConfirmed = candlesRef.current[candlesRef.current.length - 1];
        if (lastConfirmed && candleTimestamp < lastConfirmed.timestamp) return;
        if (lastConfirmed && candleTimestamp === lastConfirmed.timestamp) {
          Object.assign(lastConfirmed, {
            open: parseFloat(candle.open), high: parseFloat(candle.high), low: parseFloat(candle.low),
            close: parseFloat(candle.close), volume: parseFloat(candle.volume),
          });
          return;
        }
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
          log.candle(symbol, '🆕 Primera vela en progreso', {
            timestamp: candleTimestamp,
            datetime: datetime_colombia
          });
          
        } else if (candleTimestamp > currentInProgress.timestamp) {
          log.candle(symbol, '🔄 CAMBIO DE TIMESTAMP - Confirmando vela anterior', {
            anterior: currentInProgress.timestamp,
            nuevo: candleTimestamp
          });
          
          candlesRef.current.push(currentInProgress);
          
          if (candlesRef.current.length > 2000) {
            candlesRef.current.shift();
          }
          
          log.candle(symbol, '✅ Vela confirmada y agregada', {
            total_confirmadas: candlesRef.current.length
          });
          
          inProgressCandleRef.current = newCandle;
          log.state(symbol, candlesRef.current.length, true);

          // ✅ Verificar gap cuando se confirma una vela
          if (indicatorManagerRef.current) {
            indicatorManagerRef.current.checkAndRefreshIfNeeded(candlesRef.current);
          }

          // 🎯 NUEVO: Analizar rangos cuando se confirma nueva vela
          if (indicatorManagerRef.current && indicatorManagerRef.current.isRangeDetectionEnabled()) {
            log.candle(symbol, `🔄 Nueva vela confirmada - analizando rangos`);
            indicatorManagerRef.current.analyzeRanges(candlesRef.current);
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

  // ==================== ZOOM PRESETS HANDLERS ====================

  // 🎯 Cargar presets desde localStorage al montar el componente
  useEffect(() => {
    const stored = localStorage.getItem('zoom_presets');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setZoomPresets(parsed.presets || []);
      } catch (e) {
        console.error('Error loading zoom presets:', e);
        // Usar presets por defecto
        const defaultPresets = [
          { id: 1, enabled: true, days: 1, label: "1D" },
          { id: 2, enabled: true, days: 3, label: "3D" },
          { id: 3, enabled: true, days: 7, label: "1W" },
          { id: 4, enabled: true, days: null, label: "ALL" }
        ];
        setZoomPresets(defaultPresets);
      }
    } else {
      // Presets por defecto en primera carga
      const defaultPresets = [
        { id: 1, enabled: true, days: 1, label: "1D" },
        { id: 2, enabled: true, days: 3, label: "3D" },
        { id: 3, enabled: true, days: 7, label: "1W" },
        { id: 4, enabled: true, days: null, label: "ALL" }
      ];
      setZoomPresets(defaultPresets);
      localStorage.setItem('zoom_presets', JSON.stringify({ presets: defaultPresets }));
    }
  }, []);

  // 🎯 Aplicar preset de zoom
  const applyZoomPreset = (preset) => {
    const canvas = canvasRef.current;
    if (!canvas || !candlesRef.current || candlesRef.current.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const chartWidth = rect.width - 75; // Restar márgenes

    let targetCandles;

    if (preset.days === null) {
      // "ALL" - mostrar todas las velas disponibles
      targetCandles = candlesRef.current.length;
    } else {
      // Calcular número de velas según días y timeframe
      const candlesPerDay = getIntervalMilliseconds("D") / getIntervalMilliseconds(interval);
      targetCandles = Math.ceil(preset.days * candlesPerDay);

      // No exceder el número total de velas disponibles
      targetCandles = Math.min(targetCandles, candlesRef.current.length);
    }

    // Calcular zoom necesario para mostrar exactamente ese número de velas
    // Fórmula: candlesPerScreen = chartWidth / (8 * zoom)
    // Despejando: zoom = chartWidth / (8 * candlesPerScreen)
    const baseWidth = 8; // ancho base por vela
    const newZoom = chartWidth / (baseWidth * targetCandles);

    // 🎯 IMPORTANTE: No aplicar límites artificiales aquí - permitir cualquier zoom
    // El límite mínimo se calculará dinámicamente en handleWheel
    viewStateRef.current.zoom = Math.max(0.01, newZoom); // Solo evitar zoom = 0
    viewStateRef.current.offset = 0; // Ir al final (velas más recientes)
    manualPanRef.current = false; // 🎯 NUEVO: Resetear flag de paneo manual

    // Marcar este preset como activo
    setActivePreset(preset.id);

    // Redibujar
    drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);

    console.log(`[${symbol}] 🎯 Preset aplicado: ${preset.label}`, {
      targetDays: preset.days,
      targetCandles,
      totalCandles: candlesRef.current.length,
      newZoom: viewStateRef.current.zoom.toFixed(3),
      candlesPerScreen: Math.floor(chartWidth / (baseWidth * viewStateRef.current.zoom))
    });
  };

  // 🎯 Actualizar presets desde modal de configuración
  const handlePresetsApply = (newPresets) => {
    setZoomPresets(newPresets);
  };

  // ==================== MOUSE HANDLERS ====================

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // SL o TP de una posición real que se arrastra: la línea sigue al mouse hasta soltar
    if (positionDragRef.current) {
      const drag = positionDragRef.current;
      if (scaleConverterRef.current) drag.price = scaleConverterRef.current.yToPrice(y);
      if (Math.abs(y - drag.startY) > 3) drag.moved = true;
      drawChart(candlesRef.current, lastPriceRef.current, null, null);
      return;
    }

    // 🎯 NUEVO: Measurement tool en progreso
    if (measurementToolRef.current && measurementToolRef.current.isMeasuring()) {
      measurementToolRef.current.handleMouseMove(x, y);
      drawChart(candlesRef.current, lastPriceRef.current, null, null);
      return;
    }

    // 🔧 FIX: Detectar si un potencial drag se convierte en drag real (threshold: 5px)
    // IMPORTANTE: Solo si NO está arrastrando un dibujo
    if (dragStateRef.current.potentialDrag && !dragStateRef.current.isDragging) {
      // Verificar que el DrawingManager NO esté interactuando
      const drawingIsInteracting = drawingManagerRef.current && drawingManagerRef.current.isInteracting();

      if (!drawingIsInteracting) {
        const deltaX = Math.abs(x - dragStateRef.current.startX);
        const deltaY = Math.abs(y - dragStateRef.current.startY);
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        if (distance > 5) {
          // Usuario arrastró suficiente distancia - activar paneo y pausar playback
          dragStateRef.current.isDragging = true;
          dragStateRef.current.potentialDrag = false;

          if (backtestingMode && onRequestPause) {
            onRequestPause();
            manualPanRef.current = true;
            setShowFollowButton(true);
          }

          if (canvasRef.current) {
            canvasRef.current.style.cursor = 'grabbing';
          }
        }
      }
    }

    // 🎯 NUEVO: Drawing manager activo (drag/resize)
    if (drawingManagerRef.current && drawingManagerRef.current.isInteracting()) {
      // Si hay potentialDrag pero el usuario está arrastrando un dibujo, cancelar potentialDrag
      if (dragStateRef.current.potentialDrag) {
        dragStateRef.current.potentialDrag = false;
      }

      drawingManagerRef.current.handleMouseMove(x, y, scaleConverterRef.current);
      drawChart(candlesRef.current, lastPriceRef.current, null, null);
      return;
    }

    if (dragStateRef.current.isDragging) {
      // 🎯 CORREGIDO: Marcar que el usuario hizo paneo manual
      manualPanRef.current = true;

      // 🎯 NUEVO: Si estamos en modo backtesting, pausar la reproducción y mostrar botón Follow
      if (backtestingMode) {
        if (onRequestPause) {
          onRequestPause();
        }
        setShowFollowButton(true);
      }

      // Paneo horizontal
      const deltaX = x - dragStateRef.current.startX;
      const chartWidth = rect.width - 75;
      const effectiveBarWidth = Math.max(0.1, Math.min(MAX_BAR_WIDTH, 8 * viewStateRef.current.zoom));
      const candlesPerScreen = Math.floor(chartWidth / effectiveBarWidth);
      const deltaCandlesFloat = (deltaX / chartWidth) * candlesPerScreen;
      const deltaCandles = Math.round(deltaCandlesFloat);

      // Calcular maxOffset basado en las velas que se van a dibujar (candlesRef)
      // Usar allCandlesRef aquí causaba que el offset excediera las velas disponibles
      const maxOffset = Math.max(0, candlesRef.current.length - candlesPerScreen);
      const newOffset = Math.max(0, Math.min(maxOffset, dragStateRef.current.startOffset + deltaCandles));
      viewStateRef.current.offset = newOffset;

      // Paneo vertical
      const deltaY = y - dragStateRef.current.startY;
      const newVerticalOffset = dragStateRef.current.startVerticalOffset + deltaY;
      viewStateRef.current.verticalOffset = newVerticalOffset;

      // 🎯 FIX: En modo backtesting, dibujar con candlesRef (velas hasta el punto de playback)
      // Usar allCandlesRef causaba un "volteo" porque displayCandles.length saltaba
      // de ~500 (playback) a ~4380 (todas), desplazando la fórmula de startIdx
      drawChart(candlesRef.current, lastPriceRef.current, null, null);
    } else {
      setMousePos({ x, y });
      drawChart(candlesRef.current, lastPriceRef.current, x, y);
      const positionHit = onPositionAction ? hitPositionTarget(positionTargetsRef.current, x, y) : null;
      canvas.style.cursor = positionHit ? positionHit.cursor : (levelsNear(levelTargetsRef.current, x, y).length ? 'pointer' : 'crosshair');
    }
  };

  // Clic sin arrastrar sobre un nivel: abre el menú para incluirlo en el análisis
  const handleChartClick = (e) => {
    const drag = dragStateRef.current;
    const canvas = canvasRef.current;
    if (!drag.isDragging || drag.drawingHandled || e.button !== 0 || !canvas) return;
    if (drawingManagerRef.current && drawingManagerRef.current.currentTool !== 'select') return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (Math.hypot(x - drag.startX, y - drag.startY) > 4) return;

    const levels = levelsNear(levelTargetsRef.current, x, y);
    const menuHeight = 40 + levels.length * 30 + 90; // Con un elegido abierto, su papel y su nota
    setLevelMenu(levels.length ? { x: Math.min(x + 10, rect.width - 290), y: Math.max(0, Math.min(y + 10, rect.height - menuHeight)), levels } : null);
  };

  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 🎯 NUEVO: Usar el scaleConverter guardado del último render
    const scaleConverter = scaleConverterRef.current;

    // Posiciones reales (suite), solo con el cursor: × cierra o cancela al soltar; la etiqueta de SL o TP se arrastra
    if (e.button === 0 && onPositionAction && (!drawingManagerRef.current || drawingManagerRef.current.currentTool === 'select')) {
      const hit = hitPositionTarget(positionTargetsRef.current, x, y);
      if (hit) {
        if (hit.action === 'drag' || hit.action === 'create') {
          positionDragRef.current = { lineId: hit.line.id, line: hit.line, field: hit.field, price: hit.price, startY: y, moved: false };
          canvas.style.cursor = 'ns-resize';
        } else {
          positionPressRef.current = hit;
        }
        dragStateRef.current = { isDragging: false, potentialDrag: false };
        return;
      }
    }

    // 🎯 NUEVO: Middle click para measurement tool
    if (e.button === 1 && measurementToolRef.current && scaleConverter) {
      measurementToolRef.current.handleMouseDown(x, y, scaleConverter);
      drawChart(candlesRef.current, lastPriceRef.current, null, null);
      return;
    }

    // 🎯 NUEVO: Left click para drawing manager
    if (e.button === 0 && drawingManagerRef.current && scaleConverter) {
      const shapesBefore = drawingManagerRef.current.shapes.length;
      const handled = drawingManagerRef.current.handleMouseDown(x, y, scaleConverter);

      if (handled) {
        // Un dibujo nuevo se avisa de una vez: la caja TP/SL alimenta el panel de órdenes
        if (drawingManagerRef.current.shapes.length !== shapesBefore) {
          saveDrawings();
          // Una caja de texto nueva se escribe enseguida, y la herramienta vuelve al cursor
          const created = drawingManagerRef.current.shapes[drawingManagerRef.current.shapes.length - 1];
          if (created?.type === 'textbox') {
            drawingManagerRef.current.setTool('select');
            onToolChange?.('select');
            setTimeout(() => openTextEditor(created), 0);
          }
        }

        // El drawing manager consumió el evento
        drawChart(candlesRef.current, lastPriceRef.current, null, null);

        // 🔧 FIX: En backtesting, también preparar dragState por si el usuario arrastra
        // Esto permite paneo incluso si clickeó sobre un dibujo
        if (backtestingMode) {
          dragStateRef.current = {
            isDragging: false, // No activo aún, solo preparado
            potentialDrag: true, // Nuevo flag
            startX: x,
            startY: y,
            startOffset: viewStateRef.current.offset,
            startVerticalOffset: viewStateRef.current.verticalOffset || 0,
            drawingHandled: true // Indica que un dibujo consumió el evento inicial
          };
        }
        return;
      }
    }

    // Si no fue consumido por drawing, proceder con paneo normal
    dragStateRef.current = {
      isDragging: true,
      startX: x,
      startY: y,
      startOffset: viewStateRef.current.offset,
      startVerticalOffset: viewStateRef.current.verticalOffset || 0
    };
    canvas.style.cursor = 'grabbing';
  };

  const handleMouseUp = (e) => {
    // × de una posición u orden real: la acción sale solo si se suelta sobre la misma ×
    if (positionPressRef.current) {
      const press = positionPressRef.current;
      positionPressRef.current = null;
      const rect = canvasRef.current?.getBoundingClientRect();
      const hit = rect ? hitPositionTarget(positionTargetsRef.current, e.clientX - rect.left, e.clientY - rect.top) : null;
      if (hit && hit.action === press.action && hit.line.id === press.line.id && hit.field === press.field) {
        onPositionAction?.({ type: press.action, line: press.line, field: press.field, lastPrice: positionPriceRef.current });
      }
      return;
    }
    // SL o TP arrastrado: se propone el precio nuevo (quien da los datos confirma y lo envía)
    if (positionDragRef.current) {
      const drag = positionDragRef.current;
      positionDragRef.current = null;
      drawChart(candlesRef.current, lastPriceRef.current, null, null, true);
      if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
      if (drag.moved && Number.isFinite(drag.price)) {
        onPositionAction?.({ type: 'move', line: drag.line, field: drag.field, price: drag.price, lastPrice: positionPriceRef.current });
      }
      return;
    }

    // 🎯 NUEVO: Finalizar measurement tool
    if (measurementToolRef.current && measurementToolRef.current.isMeasuring()) {
      measurementToolRef.current.handleMouseUp();
      drawChart(candlesRef.current, lastPriceRef.current, null, null);
      return;
    }

    // 🎯 NUEVO: Finalizar drawing manager interaction
    if (drawingManagerRef.current && drawingManagerRef.current.isInteracting()) {
      drawingManagerRef.current.handleMouseUp();

      // Auto-guardar después de drag/resize
      saveDrawings();

      drawChart(candlesRef.current, lastPriceRef.current, null, null);

      // 🔧 FIX: Limpiar potentialDrag si existía
      if (dragStateRef.current.potentialDrag) {
        dragStateRef.current.potentialDrag = false;
      }
      return;
    }

    handleChartClick(e);

    // 🔧 FIX: Limpiar potentialDrag
    dragStateRef.current.isDragging = false;
    dragStateRef.current.potentialDrag = false;
    if (canvasRef.current) {
      canvasRef.current.style.cursor = 'crosshair';
    }
  };

  const handleMouseLeave = () => {
    positionDragRef.current = null; // Un arrastre de SL/TP que sale del gráfico no se envía
    positionPressRef.current = null;
    dragStateRef.current.isDragging = false;
    dragStateRef.current.potentialDrag = false; // 🔧 FIX: Limpiar potentialDrag
    setMousePos(null);
    drawChart(candlesRef.current, lastPriceRef.current, null, null);
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

      if (!priceScaleRef.current) return;

      // La misma escala y altura del último dibujo: así el precio bajo el mouse no se desplaza
      const { minPrice, maxPrice, marginTop, priceChartHeight } = priceScaleRef.current;
      const priceRange = maxPrice - minPrice;

      // Verificar que el mouse está en el área del gráfico de precios
      if (mouseY < marginTop || mouseY > (marginTop + priceChartHeight)) {
        return; // No hacer zoom si el mouse está fuera del área de precios
      }

      const oldVerticalZoom = viewStateRef.current.verticalZoom || 1;
      const oldVerticalOffset = viewStateRef.current.verticalOffset || 0;
      const oldBaseYScale = priceRange > 0 ? priceChartHeight / priceRange : 1;
      const oldYScale = oldBaseYScale * oldVerticalZoom;

      // 🎯 Precio en la posición del mouse ANTES del zoom
      // Fórmula de drawChart: yCanvas = marginTop + priceChartHeight - (price - minPrice) * yScale + verticalOffset
      // Despejando price: price = minPrice + (marginTop + priceChartHeight - yCanvas + verticalOffset) / yScale
      const priceAtMouse = minPrice + (marginTop + priceChartHeight - mouseY + oldVerticalOffset) / oldYScale;

      // 🎯 MODIFICADO: Mayor sensibilidad en zoom vertical (1.15/0.85 en lugar de 1.1/0.9)
      // Aumentado a 10x para mejor visualización de patrones
      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.85;
      const newVerticalZoom = Math.max(0.3, Math.min(10, oldVerticalZoom * zoomFactor));
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
    // 🎯 FIX: Definir canvas PRIMERO antes de usarlo
    const canvas = canvasRef.current;
    if (!canvas) return;

    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const oldZoom = viewStateRef.current.zoom;

    // Zoom limits: 0.01 (extreme zoom out, ~0.1px candles) to MAX_ZOOM (velas de 400px)
    const newZoom = Math.max(0.01, Math.min(MAX_ZOOM, oldZoom * zoomFactor));
    viewStateRef.current.zoom = newZoom;

    // Desmarcar preset activo si el usuario hace zoom manual
    if (activePreset !== null) {
      setActivePreset(null);
    }

    // Ajustar offset para mantener la vista coherente
    const rect = canvas.getBoundingClientRect();
    const chartWidth = rect.width - 75;
    const effectiveBarWidth = Math.max(0.1, Math.min(MAX_BAR_WIDTH, 8 * newZoom));
    const candlesPerScreen = Math.floor(chartWidth / effectiveBarWidth);
    const maxOffset = Math.max(0, candlesRef.current.length - candlesPerScreen);
    viewStateRef.current.offset = Math.min(viewStateRef.current.offset, maxOffset);

    drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
  };

  const goToLatestCandle = () => {
    viewStateRef.current.offset = 0;
    drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
  };

  // 🎯 NUEVO: Función para activar el modo Follow (auto-scroll)
  const handleFollowClick = () => {
    manualPanRef.current = false;
    setShowFollowButton(false);
    console.log(`[${symbol}] Follow mode reactivated`);
  };

  /** Abre el editor sobre una caja de texto del gráfico, en su lugar y con su tamaño */
  const openTextEditor = (shape) => {
    const scale = scaleConverterRef.current;
    const canvas = canvasRef.current;
    if (!shape || !scale || !canvas) return;
    const x = scale.timeToX(shape.time);
    const y = scale.priceToY(shape.price);
    if (x == null || !Number.isFinite(y)) return;
    const { width, height } = shape.calculateDimensions(canvas.getContext('2d'));
    const placeholder = shape.text === 'Escribe aquí...' || shape.text === 'Texto...';
    const editor = { id: shape.id, x, y, width: Math.max(160, width), height: Math.max(60, height), value: placeholder ? '' : shape.text };
    textEditorRef.current = editor;
    setTextEditor(editor);
  };

  /** Guarda el texto escrito en su caja. Vacío deja la caja con su texto de antes */
  const closeTextEditor = (save) => {
    const current = textEditorRef.current;
    textEditorRef.current = null; // El blur llega después de Esc o Ctrl+Enter: no se guarda dos veces
    if (!current) return;
    const shape = drawingManagerRef.current?.shapes.find(item => item.id === current.id);
    if (save && shape && current.value.trim()) {
      shape.setText(current.value.replace(/\s+$/, ''));
      drawingManagerRef.current.saveToHistory();
      saveDrawings();
    }
    setTextEditor(null);
    drawChart(candlesRef.current, lastPriceRef.current, null, null);
  };

  const handleDoubleClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !candlesRef.current || candlesRef.current.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const width = rect.width;
    const height = rect.height;
    const marginLeft = 50;
    const marginRight = 65;
    const marginTop = 30;
    const timeAxisHeight = 25;
    const volumeHeight = 60;

    const priceChartHeight = height - marginTop - volumeHeight - timeAxisHeight - 20;

    // Doble clic sobre una caja de texto: escribir en ella
    const converter = scaleConverterRef.current;
    const textShape = converter && drawingManagerRef.current?.shapes
      .filter(shape => shape.type === 'textbox')
      .reverse()
      .find(shape => shape.hitTest(x, y, converter, 2));
    if (textShape) {
      openTextEditor(textShape);
      return;
    }

    // 🎯 Verificar si el doble click fue en el área del eje de precios (derecha)
    const isInPriceAxis = x >= (width - marginRight) && x <= width;
    const isInPriceChartArea = y >= marginTop && y <= (marginTop + priceChartHeight);

    if (isInPriceAxis && isInPriceChartArea) {
      // 🎯 Auto-scale vertical: resetear zoom y offset para llenar la ventana
      viewStateRef.current.verticalZoom = 1;
      viewStateRef.current.verticalOffset = 0;

      drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
      return;
    }

    // Con Order Flow activo, doble clic sobre una vela: acercarse para leer su footprint
    const scale = priceScaleRef.current;
    const orderFlowIndicator = indicatorManagerRef.current?.getOrderFlowIndicator?.();
    const isOverCandles = scale
      && x >= scale.marginLeft && x <= scale.marginLeft + scale.chartWidth
      && y >= scale.marginTop && y <= scale.marginTop + scale.priceChartHeight;

    if (orderFlowIndicator?.enabled && isOverCandles && drawingManagerRef.current?.currentTool === 'select') {
      const barWidth = scale.chartWidth / scale.visibleCount;
      const index = scale.startIdx + Math.floor((x - scale.marginLeft) / barWidth);
      const candlesPerScreen = Math.floor(scale.chartWidth / (8 * FOOTPRINT_ZOOM));

      viewStateRef.current.zoom = FOOTPRINT_ZOOM;
      viewStateRef.current.offset = Math.max(0, scale.totalCount - index - Math.ceil(candlesPerScreen / 2));
      manualPanRef.current = true;
      setShowFollowButton(true);
      onRequestPause?.();

      drawChartRef.current?.(candlesRef.current, lastPriceRef.current, null, null);
    }
  };

  // ==================== FIXED RANGE PROFILES ====================
  
  const handleCreateFixedRangeProfile = (startTimestamp, endTimestamp, applyToAll = false, sourceRectId = null) => {
    if (indicatorManagerRef.current) {
      const rangeId = indicatorManagerRef.current.createFixedRangeProfile(startTimestamp, endTimestamp, sourceRectId);
      const profiles = indicatorManagerRef.current.getFixedRangeProfiles();
      setFixedRangeProfiles(profiles);
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

  const handleToggleFixedRangeProfile = (rangeId, enabled) => {
    if (indicatorManagerRef.current) {
      indicatorManagerRef.current.toggleFixedRangeProfile(rangeId, enabled);
      const profiles = indicatorManagerRef.current.getFixedRangeProfiles();
      setFixedRangeProfiles(profiles);
      indicatorManagerRef.current.saveFixedRangeProfilesToStorage();
      drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
    }
  };

  const handleStartDrawRectangle = () => {
    // Cerrar modal y activar herramienta de rectángulo para dibujar en el chart
    setShowFixedRangeManager(false);
    pendingVPFixedFromRectRef.current = true;
    if (onToolChange) onToolChange('rectangle');
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
          clusterColor: profile.clusterColor,
          customVisual: profile.customVisual
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

  // Lo cambiado en el modal del volumen se ve al instante: el redibujo del propio modal todavía usaba los valores anteriores
  useEffect(() => {
    if (candlesRef.current?.length) drawChartRef.current?.(candlesRef.current, lastPriceRef.current, null, null);
  }, [volumeVisualParams]);

  useEffect(() => {
    if (indicatorManagerRef.current && indicatorManagerRef.current.days !== parseInt(days)) {
      log.indicator(symbol, `Días cambiados de ${indicatorManagerRef.current.days} a ${days}`);
      
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

  // 🎯 REMOVIDO: useEffect duplicado que usaba toggleIndicator
  // Ahora se usa updateIndicatorStates en el MAIN EFFECT y en el otro useEffect

  // 🎯 Cargar todas las velas UNA VEZ al inicio (para binary search)
  useEffect(() => {
    console.log(`%c[MiniChart ${symbol} ${interval}] 🔍 USEEFFECT ALLCANDLES EJECUTÁNDOSE`, 'background: #FF00FF; color: white; font-weight: bold;');

    // Reset del flag cuando cambia el interval o backtestingData
    initialRenderDoneRef.current = false;
    lastIndexRef.current = -1; // 🎯 CRÍTICO: Reset para forzar re-render en próximo Binary Search
    formingKeyRef.current = 0;

    console.log(`[MiniChart ${symbol} ${interval}] 🔍 backtestingMode=${backtestingMode}, hasData=${!!backtestingData}`);

    if (!backtestingMode || !backtestingData) {
      console.log(`[MiniChart ${symbol} ${interval}] ⚠️ No hay datos de backtesting aún (mode=${backtestingMode}, data=${!!backtestingData})`);
      return;
    }

    const timeframeData = backtestingData.timeframes?.[interval];

    if (timeframeData?.main) {
      // Las velas del marco llegan una sola vez, en main. La vela en formación se arma con
      // los marcos menores ya cerrados (formingCandle), no con velas de este arreglo
      allCandlesRef.current = timeframeData.main.filter(isValidCandle);

      console.log(`[MiniChart ${symbol} ${interval}] 🔍 allCandlesRef.current.length = ${allCandlesRef.current.length}`);

      // 🎯 ELIMINADO: Ya NO reseteamos el caché del VWAP
      // El VWAP detecta automáticamente cambios en allCandles.length y se recalcula si es necesario
    } else {
      console.warn(`%c[MiniChart ${symbol} ${interval}] ❌ NO HAY DATOS MAIN en timeframe`, 'background: #FF0000; color: white; font-weight: bold;');
    }
  }, [backtestingMode, backtestingData, backtestingData?.timeframes?.[interval]?.main?.length, interval, symbol]);

  // 🎯 ELIMINADO - Ya no es necesario, el Binary Search maneja todo desde el inicio

  // 🎯 OPTIMIZADO: Efecto para modo backtesting - filtrar velas con Binary Search
  useEffect(() => {
    // IMPORTANTE: Solo ejecutar en modo backtesting con datos disponibles
    if (!backtestingMode || !backtestingData || allCandlesRef.current.length === 0) return;
    if (!currentTime || !isActive) return; // Los marcos ocultos se ponen al día cuando se muestran

    // Solo velas cerradas en la hora simulada, mas la vela en formacion armada con velas menores
    const lastIndex = lastClosedIndex(allCandlesRef.current, interval, currentTime);
    const forming = formingCandle(backtestingData.timeframes, interval, currentTime);
    const formingKey = forming ? forming.knownUntil : 0;

    // Solo actualizar si cerró una vela o avanzó la vela en formación
    if ((lastIndex < 0 && !forming) || (lastIndex === lastIndexRef.current && formingKey === formingKeyRef.current)) return;

    // Actualizar refs
    lastIndexRef.current = lastIndex;
    formingKeyRef.current = formingKey;

    candlesRef.current = syncKnownCandles(candlesRef.current, allCandlesRef.current, lastIndex, forming);
    inProgressCandleRef.current = null;

    // Actualizar precio actual
    const lastCandle = candlesRef.current[candlesRef.current.length - 1];
    if (lastCandle) {
      lastPriceRef.current = lastCandle.close;
    }

    // Sin paneo manual, la vela más reciente queda a la vista
    if (!manualPanRef.current) {
      viewStateRef.current.offset = 0;
    }

    // En la principal la hora llega a lo sumo 10 veces por segundo; en el 2.º gráfico, hasta una vez por
    // cuadro. Un cuadro pendiente se reemplaza por este. El costo del dibujo queda medido para quien
    // decide el ritmo (drawCost)
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const startedAt = performance.now();
      drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y, true);
      // Baja de inmediato y sube de a poco: un dibujo lento suelto (un indicador que se arma) no frena el ritmo
      const cost = performance.now() - startedAt;
      const previous = drawCostRef.current.ms;
      drawCostRef.current = { ms: cost < previous ? cost : previous * 0.7 + Math.min(cost, previous * 3 + 8) * 0.3, at: startedAt };
    });
  }, [backtestingMode, backtestingData, currentTime, interval, isActive]);

  // ==================== MAIN EFFECT ====================

  useEffect(() => {
    mountedRef.current = true;

    log.candle(symbol, '🚀 Componente montado, iniciando...');

    const initIndicators = async () => {
      indicatorManagerRef.current = new IndicatorManager(symbol, interval, parseInt(days));
      // El Swing toma de aquí los rectángulos del gráfico para su filtro VWAP
      indicatorManagerRef.current.getDrawingManager = () => drawingManagerRef.current;

      // 🎯 NUEVO: En modo backtesting, PRE-cargar Open Interest ANTES de initialize()
      if (backtestingMode && backtestingData) {
        const timeframeData = backtestingData.timeframes?.[interval];
        if (timeframeData && timeframeData.open_interest) {
          const oiIndicator = indicatorManagerRef.current.openInterestIndicator;
          if (oiIndicator && typeof oiIndicator.loadFromData === 'function') {
            oiIndicator.loadFromData(timeframeData.open_interest);
            oiIndicator._dataPreloaded = true; // 🎯 Flag para evitar fetch en initialize()
            console.log(`[${symbol}] ✅ Open Interest PRE-cargado desde backtestingData: ${timeframeData.open_interest.length} puntos`);
          }
        } else {
          console.warn(`[${symbol}] ⚠️ No hay datos de Open Interest en backtestingData para ${interval}`);
          console.log(`[${symbol}] Timeframes disponibles:`, Object.keys(backtestingData.timeframes || {}));
        }
      }

      await indicatorManagerRef.current.initialize(backtestingMode, simulationStartTime);

      // ✨ NUEVO: Agregar referencia a drawChart para que los indicadores puedan forzar redibujado
      indicatorManagerRef.current.requestRedraw = () => {
        if (candlesRef.current && candlesRef.current.length > 0) {
          drawChartRef.current?.(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
        }
      };

      // 🎯 FIX: Usar updateIndicatorStates para que haga fetchData de S/R y otros
      if (indicatorStates) {
        await indicatorManagerRef.current.updateIndicatorStates(indicatorStates, backtestingMode, allCandlesRef.current);
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
		console.log(`[${symbol}] ✅ Sincronizados ${profiles.length} Fixed Range Profiles`);
	  }
      log.indicator(symbol, '✅ Indicadores inicializados');
      drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
    };

    // 🎯 MODIFICADO: En modo backtesting, no cargar datos históricos ni conectar WebSocket
    if (!backtestingMode) {
      loadHistoricalData();

      const bybitInterval = getBybitInterval(interval);
      // Cada grafico recibe solo las velas de su marco (la suite tiene un MiniChart por marco)
      wsManager.subscribe(symbol, handleWebSocketMessage, bybitInterval);

      log.ws(symbol, `Suscrito a WebSocket @ ${bybitInterval}`);
    }

    initIndicators();

    // 🎯 NUEVO: Inicializar sistema de dibujo
    drawingManagerRef.current = new DrawingToolManager(symbol, interval, null, (shape) => {
      // Callback cuando se agrega un shape: actualizar rectángulos disponibles
      if (shape) shape.createdAt = simulatedNowRef.current ?? null;
      updateChartRectangles();

      // Auto-crear VP Fixed si el usuario dibujó un rectángulo desde el modal
      if (pendingVPFixedFromRectRef.current && shape && shape.type === 'rectangle') {
        pendingVPFixedFromRectRef.current = false;
        const tStart = Math.min(shape.time1, shape.time2);
        const tEnd = Math.max(shape.time1, shape.time2);
        const rectId = shape.id;
        // Salir del modo dibujo y crear el VP Fixed
        if (onToolChange) onToolChange('select');
        setTimeout(() => {
          handleCreateFixedRangeProfile(tStart, tEnd, false, rectId);
          saveDrawings();
        }, 50);
      }
    });
    drawingManagerRef.current.setTool(currentTool);

    measurementToolRef.current = new MeasurementTool();

    // Cargar dibujos guardados
    loadDrawings();

    console.log(`[${symbol}] ✅ Sistema de dibujo inicializado`);

    // 🎯 MODIFICADO: Solo configurar intervalos en modo NO-backtesting
    let reloadInterval, patternDetectionInterval;

    if (!backtestingMode) {
      // ✅ REDUCIDO: Recarga cada 5 minutos (el auto-refresh de indicadores se hace cada 1 min)
      reloadInterval = setInterval(() => {
        log.candle(symbol, '🔄 Recarga periódica histórico (5 min)');
        loadHistoricalData();
      }, 300000);

      // ✅ NUEVO: Chequeo de gaps cada 30 segundos
      gapCheckIntervalRef.current = setInterval(() => {
        if (indicatorManagerRef.current && candlesRef.current.length > 0) {
          indicatorManagerRef.current.checkAndRefreshIfNeeded(candlesRef.current);
        }
      }, 30000);

      // 🎯 NUEVO: Detección de patrones de rechazo cada 2 minutos
      patternDetectionInterval = setInterval(async () => {
        if (indicatorManagerRef.current && rejectionPatternConfig) {
          log.indicator(symbol, '🔍 Ejecutando detección de patrones de rechazo...');
          try {
            const patterns = await indicatorManagerRef.current.detectRejectionPatterns();
            if (patterns && patterns.length > 0) {
              log.indicator(symbol, `✅ Detectados ${patterns.length} patrones`);
              drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
            }
          } catch (error) {
            log.error(symbol, 'Error en detección de patrones', error);
          }
        }
      }, 120000); // Cada 2 minutos
    }

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
      log.candle(symbol, '🛑 Componente desmontado, limpiando...');

      mountedRef.current = false;

      // 🎯 MODIFICADO: Solo desuscribir WebSocket si NO está en modo backtesting
      if (!backtestingMode) {
        wsManager.unsubscribe(symbol, handleWebSocketMessage, getBybitInterval(interval));
      }

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      // 🎯 MODIFICADO: Solo limpiar intervalos si existen (modo NO-backtesting)
      if (reloadInterval) {
        clearInterval(reloadInterval);
      }

      // ✅ NUEVO: Limpiar intervalos de gap check
      if (gapCheckIntervalRef.current) {
        clearInterval(gapCheckIntervalRef.current);
      }

      // 🎯 NUEVO: Limpiar intervalo de detección de patrones
      if (patternDetectionInterval) {
        clearInterval(patternDetectionInterval);
      }

      // ✅ NUEVO: Destruir IndicatorManager correctamente
      if (indicatorManagerRef.current) {
        indicatorManagerRef.current.destroy();
      }

      candlesRef.current = [];
      inProgressCandleRef.current = null;

      if (canvas) {
        canvas.removeEventListener('wheel', preventScroll);
        canvas.removeEventListener('dblclick', handleDoubleClick);
      }
    };
  }, [symbol, interval, days, backtestingMode]); // 🎯 FIX: Removed indicatorStates to prevent remounting

  // 🎯 NUEVO: Manejar cambios en indicatorStates SIN recrear el IndicatorManager
  useEffect(() => {
    if (!indicatorManagerRef.current) return;

    console.log(`[MiniChart] Actualizando indicadores:`, indicatorStates);
    console.log(`[MiniChart] Velas disponibles:`, candlesRef.current?.length || 0);
    console.log(`[MiniChart] Modo backtesting:`, backtestingMode);

    // 🎯 CRÍTICO: Llamar al nuevo método updateIndicatorStates() en lugar de recrear
    indicatorManagerRef.current.updateIndicatorStates(indicatorStates, backtestingMode, allCandlesRef.current)
      .then(() => {
        // Redibujar después de actualizar
        if (candlesRef.current && candlesRef.current.length > 0) {
          console.log(`[MiniChart ${symbol} ${interval}] Redibujando por cambio en indicatorStates - ${candlesRef.current.length} velas`);
          drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
        }
      })
      .catch(error => {
        console.error(`[MiniChart ${symbol} ${interval}] Error actualizando indicadores:`, error);
      });
  }, [indicatorStates]); // Solo reaccionar a cambios en indicatorStates

  const handlePanelMove = (name, step) => {
    indicatorManagerRef.current?.movePanel(name, step);
    setPanelVersion(version => version + 1);
  };

  const handlePanelResizeStart = (e, panel) => {
    e.preventDefault();
    const { availableHeight, heightScale } = priceScaleRef.current;
    panelResizeRef.current = {
      name: panel.name,
      startY: e.clientY,
      shown: panel.height,
      scale: heightScale,
      others: volumeHeight + indicatorManagerRef.current.getTotalHeight() - panel.requested,
      availableHeight,
      ratio: priceChartRatio
    };
    setResizingPanel(panel.name);
  };

  // Arrastrar el borde superior de un panel solo cambia ese panel: el precio cede o recibe la diferencia
  useEffect(() => {
    if (!resizingPanel) return undefined;

    const handleMove = (e) => {
      const drag = panelResizeRef.current;
      const { height, ratio } = resizePanel({ ...drag, delta: drag.startY - e.clientY });
      drag.lastRatio = ratio;
      indicatorManagerRef.current.setPanelHeight(drag.name, height);
      setPriceChartRatio(ratio);
      setPanelVersion(version => version + 1);
    };
    const handleUp = () => {
      const { lastRatio } = panelResizeRef.current;
      indicatorManagerRef.current.savePanels();
      if (lastRatio !== undefined) localStorage.setItem(`priceChartRatio_${symbol}`, lastRatio.toString());
      setResizingPanel(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [resizingPanel, symbol]);

  // 🎯 NUEVO: Handlers para divisor redimensionable
  const handleDividerMouseDown = (e) => {
    e.preventDefault();
    setIsDraggingDivider(true);
  };

  const handleDividerMouseMove = (e) => {
    if (!isDraggingDivider || !canvasRef.current || !priceScaleRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const { marginTop, availableHeight } = priceScaleRef.current;
    const newRatio = Math.max(0.3, Math.min(0.85, (mouseY - marginTop) / availableHeight)); // Entre 30% y 85%

    setPriceChartRatio(newRatio);
  };

  const handleDividerMouseUp = () => {
    if (isDraggingDivider) {
      setIsDraggingDivider(false);
      // Guardar en localStorage
      localStorage.setItem(`priceChartRatio_${symbol}`, priceChartRatio.toString());
      // Redibujar
      if (candlesRef.current && candlesRef.current.length > 0) {
        drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
      }
    }
  };

  // Agregar listener global para mouse move/up del divisor
  useEffect(() => {
    if (isDraggingDivider) {
      window.addEventListener('mousemove', handleDividerMouseMove);
      window.addEventListener('mouseup', handleDividerMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleDividerMouseMove);
        window.removeEventListener('mouseup', handleDividerMouseUp);
      };
    }
  }, [isDraggingDivider, priceChartRatio]);

  // 🎯 NUEVO: Handlers para divisor de volumen redimensionable
  const handleVolumeDividerMouseDown = (e) => {
    e.preventDefault();
    setIsDraggingVolumeDivider(true);
  };

  const handleVolumeDividerMouseMove = (e) => {
    if (!isDraggingVolumeDivider || !canvasRef.current || !priceScaleRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;

    // Calcular la altura del volumen basado en la posición del mouse
    // El divisor está en la parte superior del panel de volumen
    const newVolumeHeight = Math.max(30, Math.min(300, mouseY - priceScaleRef.current.priceAreaEnd));

    setVolumeHeight(newVolumeHeight);
  };

  const handleVolumeDividerMouseUp = () => {
    if (isDraggingVolumeDivider) {
      setIsDraggingVolumeDivider(false);
      // Guardar en localStorage
      localStorage.setItem(`volumeHeight_${symbol}`, volumeHeight.toString());
      // Redibujar
      if (candlesRef.current && candlesRef.current.length > 0) {
        drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
      }
    }
  };

  // Agregar listener global para mouse move/up del divisor de volumen
  useEffect(() => {
    if (isDraggingVolumeDivider) {
      window.addEventListener('mousemove', handleVolumeDividerMouseMove);
      window.addEventListener('mouseup', handleVolumeDividerMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleVolumeDividerMouseMove);
        window.removeEventListener('mouseup', handleVolumeDividerMouseUp);
      };
    }
  }, [isDraggingVolumeDivider, volumeHeight, priceChartRatio]);

  // ==================== RENDER ====================

  return (
    <>
      <div className="mini-chart">
        {/* 🎯 FIX: Contenedor de botones PRIMERO para que capturen eventos antes que el canvas */}
        <div style={{
          position: 'absolute',
          top: '30px',
          right: '5px',
          display: 'flex',
          gap: '4px',
          zIndex: 1000,
          pointerEvents: 'auto',
          flexWrap: 'wrap',
          maxWidth: '450px',
          justifyContent: 'flex-end'
        }}>
          <button
            className="zoom-presets-config-btn"
            onClick={() => setShowPresetsConfig(true)}
            title="Configurar presets de zoom"
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
            {isNewTheme() ? <Icon name="sliders" size={14} /> : '⚙️'}
          </button>

          {zoomPresets.filter(p => p.enabled).map((preset) => (
            <button
              key={preset.id}
              className="zoom-preset-btn"
              onClick={() => applyZoomPreset(preset)}
              title={`Zoom a ${preset.days ? preset.days + ' día(s)' : 'todo el rango'}`}
              style={{
                background: activePreset === preset.id ? '#FF9800' : '#9E9E9E',
                color: 'white',
                border: activePreset === preset.id ? '2px solid #F57C00' : 'none',
                padding: '4px 8px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 'bold',
                transition: 'all 0.2s ease'
              }}
            >
              {preset.label}
            </button>
          ))}

          {!backtestingMode && (
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
              {isNewTheme() ? <Icon name="maximize" size={14} /> : '⛶'}
            </button>
          )}

          {backtestingMode && showFollowButton && (
            <button
              className="follow-btn"
              onClick={handleFollowClick}
              title="Reactivar auto-scroll"
              style={{
                background: '#FF5722',
                color: 'white',
                border: 'none',
                padding: '4px 10px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 'bold',
                animation: 'pulse 2s infinite'
              }}
            >
              {isNewTheme() ? 'Seguir' : '📍 Follow'}
            </button>
          )}

          <button
            className="goto-latest-btn"
            onClick={goToLatestCandle}
            title="Ir a ultima vela"
            style={{
              background: '#4CAF50',
              color: 'white',
              border: 'none',
              padding: '4px 8px',
              borderRadius: '3px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 'bold'
            }}
          >
            {isNewTheme() ? <Icon name="toEnd" size={14} /> : '→|'}
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
              {isNewTheme() ? 'Rechazos' : '📊 Patterns'}
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
              {isNewTheme() ? 'Rangos' : '🎯'}
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
              {isNewTheme() ? 'S&R' : '⚡'}
            </button>
          )}
          {onOpenVWAPSettings && (
            <button
              className="vwap-chart-settings-btn"
              onClick={() => onOpenVWAPSettings(indicatorManagerRef.current)}
              title="Configurar VWAP"
              style={{
                background: '#2196F3',
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
              VWAP
            </button>
          )}
          {onOpenDoubleTopBottomSettings && (
            <button
              className="dtb-chart-settings-btn"
              onClick={() => onOpenDoubleTopBottomSettings(indicatorManagerRef.current)}
              title="Configurar Double Top/Bottom"
              style={{
                background: '#E91E63',
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
              DTB
            </button>
          )}
          {onOpenOIVolumeConfluenceSettings && (
            <button
              className="oivolume-chart-settings-btn"
              onClick={() => onOpenOIVolumeConfluenceSettings(indicatorManagerRef.current)}
              title="Configurar OI-Volume Confluence"
              style={{
                background: '#2196F3',
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
              OI-Vol
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
            {isNewTheme() ? 'VP fijo' : '📊'}
          </button>
        </div>

        {/* 🎯 FIX: Canvas con eventos - renderizado DESPUÉS de botones */}
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          style={{
            cursor: 'crosshair',
            display: 'block',
            touchAction: 'none',
            position: 'relative',
            zIndex: 1  // Debajo de los botones (z-index: 1000)
          }}
        />


        {/* 🎯 NUEVO: Divisor redimensionable entre precio e indicadores */}
        <div
          onMouseDown={handleDividerMouseDown}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: priceAreaBottom ?? `${priceChartRatio * 100}%`,
            height: '4px',
            background: isDraggingDivider ? '#667eea' : 'transparent',
            cursor: 'ns-resize',
            zIndex: 1000,
            transition: isDraggingDivider ? 'none' : 'background 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#667eea';
          }}
          onMouseLeave={(e) => {
            if (!isDraggingDivider) {
              e.currentTarget.style.background = 'transparent';
            }
          }}
        >
          {/* Área de hover más amplia para facilitar el drag */}
          <div style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '-4px',
            height: '12px',
          }} />
        </div>

        {/* 🎯 NUEVO: Divisor redimensionable para altura del volumen */}
        {/* 🔧 MOVIDO: Ahora está ARRIBA del volumen (justo después del precio) para dar más espacio de ajuste */}
        <div
          onMouseDown={handleVolumeDividerMouseDown}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: priceAreaBottom !== null ? priceAreaBottom + 5 : `calc(${priceChartRatio * 100}% + 5px)`, // 5px después del precio (donde empieza el volumen)
            height: '3px',
            background: isDraggingVolumeDivider ? '#FF9800' : 'transparent',
            cursor: 'ns-resize',
            zIndex: 1000,
            transition: isDraggingVolumeDivider ? 'none' : 'background 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#FF9800';
          }}
          onMouseLeave={(e) => {
            if (!isDraggingVolumeDivider) {
              e.currentTarget.style.background = 'transparent';
            }
          }}
        >
          {/* Área de hover más amplia para facilitar el drag */}
          <div style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '-4px',
            height: '11px',
          }} />

          {/* 🎯 NUEVO: Botón de configuración de visualización de volumen */}
          <button
            className="volume-settings-btn"
            title="Configurar el dibujo del volumen"
            onClick={(e) => {
              e.stopPropagation();
              setShowVolumeSettings(!showVolumeSettings);
            }}
            style={{
              position: 'absolute',
              right: '5px',
              top: '-8px',
              width: '20px',
              height: '20px',
              borderRadius: '50%',
              border: '1px solid #FF9800',
              background: showVolumeSettings ? '#FF9800' : 'rgba(255, 152, 0, 0.2)',
              color: showVolumeSettings ? '#fff' : '#FF9800',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              padding: 0,
              zIndex: 1001,
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#FF9800';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              if (!showVolumeSettings) {
                e.currentTarget.style.background = 'rgba(255, 152, 0, 0.2)';
                e.currentTarget.style.color = '#FF9800';
              }
            }}
          >
            {isNewTheme() ? <Icon name="sliders" size={12} /> : '⚙️'}
          </button>
        </div>

        {textEditor && (
          <textarea
            className="chart-text-editor"
            ref={textAreaRef}
            autoFocus
            value={textEditor.value}
            placeholder="Escribe aquí. Ctrl+Enter guarda, Esc cancela"
            style={{
              position: 'absolute', left: textEditor.x, top: textEditor.y, width: textEditor.width, height: textEditor.height,
              zIndex: 1002, resize: 'both', font: '13px Arial', padding: 8, boxSizing: 'border-box',
              // Los colores de la caja: los del estilo en los nuevos, la nota amarilla en el Clásico
              background: isNewTheme() ? THEME.chartBg : '#FFF8DC', color: isNewTheme() ? THEME.text : '#78350F',
              border: '2px solid #3B82F6', borderRadius: 2
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const value = e.target.value;
              if (textEditorRef.current) textEditorRef.current = { ...textEditorRef.current, value };
              setTextEditor(current => current && { ...current, value });
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') closeTextEditor(false);
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) closeTextEditor(true);
            }}
            onBlur={() => closeTextEditor(true)}
          />
        )}

        {levelMenu && (
          <div ref={levelMenuRef} className="level-menu" style={{ left: levelMenu.x, top: levelMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="level-menu-title">
              Incluir en el análisis
              <button type="button" title="Cerrar" onClick={() => setLevelMenu(null)}>×</button>
            </div>
            {levelMenu.levels.map(level => {
              // Un elegible con su propia lista (las velas fijadas de Liquidaciones) no pasa a la orden ni lleva papel
              const own = level.choice;
              const chosen = own ? own.chosen(simulatedNowRef.current ?? Infinity) : chosenLevel(symbol, level.id, simulatedNowRef.current ?? Infinity);
              return (
                <div className="level-menu-item" key={level.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!chosen}
                      onChange={() => (own
                        ? own.toggle(simulatedNowRef.current ?? Date.now(), interval)
                        : toggleLevel(symbol, level, simulatedNowRef.current ?? Date.now(), interval, lastPriceRef.current))}
                    />
                    <strong>{level.kind}</strong>
                    <span>{level.source}</span>
                    <em>{level.mark || !Number.isFinite(level.price) ? '' : priceText(level.price, 1)}</em>
                  </label>
                  {chosen && !own && (
                    <div className="level-menu-detail">
                      <select
                        value={chosen.role ?? ''}
                        title="Papel en el trade"
                        onChange={(e) => updateLevel(symbol, level.id, { role: e.target.value })}
                      >
                        {level.mark ? <option value="">Solo marca</option> : (chosen.role ?? null) === null && <option value="" disabled>Elige su papel</option>}
                        {ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
                      </select>
                      <textarea
                        rows={2}
                        placeholder="¿Por qué es importante?"
                        value={chosen.note ?? ''}
                        onChange={(e) => updateLevel(symbol, level.id, { note: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {panels.map((panel, i) => (
          <React.Fragment key={panel.name}>
            <div
              onMouseDown={(e) => handlePanelResizeStart(e, panel)}
              title={`Arrastra para cambiar la altura de ${panel.name}`}
              style={{
                position: 'absolute',
                left: 0,
                right: PRICE_AXIS_WIDTH,
                top: panel.top - 2,
                height: '5px',
                background: resizingPanel === panel.name ? '#2196F3' : 'transparent',
                cursor: 'ns-resize',
                zIndex: 1000,
                transition: resizingPanel ? 'none' : 'background 0.2s'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#2196F3'; }}
              onMouseLeave={(e) => {
                if (resizingPanel !== panel.name) e.currentTarget.style.background = 'transparent';
              }}
            />
            <div style={{ position: 'absolute', right: '12px', top: panel.top + 4, display: 'flex', gap: '2px', zIndex: 1000 }}>
              {[[-1, '▲', 'Subir', i === 0], [1, '▼', 'Bajar', i === panels.length - 1]].map(([step, label, action, disabled]) => (
                <button
                  key={label}
                  className="panel-move-btn"
                  disabled={disabled}
                  onClick={() => handlePanelMove(panel.name, step)}
                  title={`${action} ${panel.name}`}
                  style={{ ...PANEL_BUTTON_STYLE, opacity: disabled ? 0.35 : 1, cursor: disabled ? 'default' : 'pointer' }}
                >
                  {label}
                </button>
              ))}
            </div>
          </React.Fragment>
        ))}
      </div>

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
              chartRectangles={chartRectangles}
              onStartDrawRectangle={handleStartDrawRectangle}
            />
          </div>
        </div>
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

      {/* 🎯 NUEVO: Modal de configuración de presets de zoom */}
      {showPresetsConfig && (
        <ZoomPresetsConfig
          onClose={() => setShowPresetsConfig(false)}
          onApply={handlePresetsApply}
        />
      )}

      {/* 🎯 NUEVO: Modal de configuración de visualización de volumen */}
      {showVolumeSettings && (
        <div
          className="modal-overlay"
          onClick={() => setShowVolumeSettings(false)}
          style={{ zIndex: 2000 }}
        >
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '450px',
              maxHeight: '80vh',
              overflow: 'auto'
            }}
          >
            <button
              className="modal-close-btn"
              onClick={() => setShowVolumeSettings(false)}
              style={{ position: 'absolute', top: '10px', right: '10px' }}
            >
              ✕
            </button>

            <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#FF9800' }}>
              ⚙️ Configuración de Visualización de Volumen
            </h3>

            {/* Sección: Intensidad */}
            <div style={{ marginBottom: '25px' }}>
              <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#666' }}>Intensidad de Color</h4>

              <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px' }}>
                Mínimo: {volumeVisualParams.intensityMin.toFixed(2)}
              </label>
              <input
                type="range"
                min="0.1"
                max="0.5"
                step="0.05"
                value={volumeVisualParams.intensityMin}
                onChange={(e) => {
                  const newParams = { ...volumeVisualParams, intensityMin: parseFloat(e.target.value) };
                  setVolumeVisualParams(newParams);
                  localStorage.setItem(`volumeVisualParams_${symbol}`, JSON.stringify(newParams));
                  if (candlesRef.current && candlesRef.current.length > 0) {
                    drawChart(candlesRef.current, lastPriceRef.current, null, null);
                  }
                }}
                style={{ width: '100%' }}
              />

              <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px', marginTop: '10px' }}>
                Máximo: {volumeVisualParams.intensityMax.toFixed(2)}
              </label>
              <input
                type="range"
                min="0.6"
                max="1.0"
                step="0.05"
                value={volumeVisualParams.intensityMax}
                onChange={(e) => {
                  const newParams = { ...volumeVisualParams, intensityMax: parseFloat(e.target.value) };
                  setVolumeVisualParams(newParams);
                  localStorage.setItem(`volumeVisualParams_${symbol}`, JSON.stringify(newParams));
                  if (candlesRef.current && candlesRef.current.length > 0) {
                    drawChart(candlesRef.current, lastPriceRef.current, null, null);
                  }
                }}
                style={{ width: '100%' }}
              />

              <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px', marginTop: '10px' }}>
                Divisor (afecta sensibilidad): {volumeVisualParams.intensityDivisor.toFixed(1)}
              </label>
              <input
                type="range"
                min="1"
                max="6"
                step="0.5"
                value={volumeVisualParams.intensityDivisor}
                onChange={(e) => {
                  const newParams = { ...volumeVisualParams, intensityDivisor: parseFloat(e.target.value) };
                  setVolumeVisualParams(newParams);
                  localStorage.setItem(`volumeVisualParams_${symbol}`, JSON.stringify(newParams));
                  if (candlesRef.current && candlesRef.current.length > 0) {
                    drawChart(candlesRef.current, lastPriceRef.current, null, null);
                  }
                }}
                style={{ width: '100%' }}
              />
            </div>

            {/* Sección: Opacidad */}
            <div style={{ marginBottom: '25px' }}>
              <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#666' }}>Opacidad Adaptativa</h4>

              <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px' }}>
                Mínimo: {volumeVisualParams.opacityMin.toFixed(2)}
              </label>
              <input
                type="range"
                min="0.1"
                max="0.6"
                step="0.05"
                value={volumeVisualParams.opacityMin}
                onChange={(e) => {
                  const newParams = { ...volumeVisualParams, opacityMin: parseFloat(e.target.value) };
                  setVolumeVisualParams(newParams);
                  localStorage.setItem(`volumeVisualParams_${symbol}`, JSON.stringify(newParams));
                  if (candlesRef.current && candlesRef.current.length > 0) {
                    drawChart(candlesRef.current, lastPriceRef.current, null, null);
                  }
                }}
                style={{ width: '100%' }}
              />

              <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px', marginTop: '10px' }}>
                Máximo: {volumeVisualParams.opacityMax.toFixed(2)}
              </label>
              <input
                type="range"
                min="0.7"
                max="1.0"
                step="0.05"
                value={volumeVisualParams.opacityMax}
                onChange={(e) => {
                  const newParams = { ...volumeVisualParams, opacityMax: parseFloat(e.target.value) };
                  setVolumeVisualParams(newParams);
                  localStorage.setItem(`volumeVisualParams_${symbol}`, JSON.stringify(newParams));
                  if (candlesRef.current && candlesRef.current.length > 0) {
                    drawChart(candlesRef.current, lastPriceRef.current, null, null);
                  }
                }}
                style={{ width: '100%' }}
              />

              <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px', marginTop: '10px' }}>
                Base: {volumeVisualParams.opacityBase.toFixed(2)}
              </label>
              <input
                type="range"
                min="0.2"
                max="0.8"
                step="0.05"
                value={volumeVisualParams.opacityBase}
                onChange={(e) => {
                  const newParams = { ...volumeVisualParams, opacityBase: parseFloat(e.target.value) };
                  setVolumeVisualParams(newParams);
                  localStorage.setItem(`volumeVisualParams_${symbol}`, JSON.stringify(newParams));
                  if (candlesRef.current && candlesRef.current.length > 0) {
                    drawChart(candlesRef.current, lastPriceRef.current, null, null);
                  }
                }}
                style={{ width: '100%' }}
              />

              <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px', marginTop: '10px' }}>
                Divisor Z-Score: {volumeVisualParams.opacityDivisor.toFixed(1)}
              </label>
              <input
                type="range"
                min="2"
                max="8"
                step="0.5"
                value={volumeVisualParams.opacityDivisor}
                onChange={(e) => {
                  const newParams = { ...volumeVisualParams, opacityDivisor: parseFloat(e.target.value) };
                  setVolumeVisualParams(newParams);
                  localStorage.setItem(`volumeVisualParams_${symbol}`, JSON.stringify(newParams));
                  if (candlesRef.current && candlesRef.current.length > 0) {
                    drawChart(candlesRef.current, lastPriceRef.current, null, null);
                  }
                }}
                style={{ width: '100%' }}
              />
            </div>

            {/* Sección: Gradiente */}
            <div style={{ marginBottom: '25px' }}>
              <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#666' }}>Gradiente Vertical</h4>

              <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px' }}>
                Contraste Inferior: {volumeVisualParams.gradientBottomMultiplier.toFixed(2)}
              </label>
              <input
                type="range"
                min="0.1"
                max="0.8"
                step="0.05"
                value={volumeVisualParams.gradientBottomMultiplier}
                onChange={(e) => {
                  const newParams = { ...volumeVisualParams, gradientBottomMultiplier: parseFloat(e.target.value) };
                  setVolumeVisualParams(newParams);
                  localStorage.setItem(`volumeVisualParams_${symbol}`, JSON.stringify(newParams));
                  if (candlesRef.current && candlesRef.current.length > 0) {
                    drawChart(candlesRef.current, lastPriceRef.current, null, null);
                  }
                }}
                style={{ width: '100%' }}
              />
              <small style={{ fontSize: '11px', color: '#999' }}>
                Menor valor = más contraste entre arriba y abajo de la barra
              </small>
            </div>

            {/* Sección: Glow Effect */}
            <div style={{ marginBottom: '25px' }}>
              <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#666' }}>Efecto Glow (Volúmenes Excepcionales)</h4>

              <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px' }}>
                Umbral Z-Score: {volumeVisualParams.glowThreshold.toFixed(1)}
              </label>
              <input
                type="range"
                min="1.0"
                max="4.0"
                step="0.1"
                value={volumeVisualParams.glowThreshold}
                onChange={(e) => {
                  const newParams = { ...volumeVisualParams, glowThreshold: parseFloat(e.target.value) };
                  setVolumeVisualParams(newParams);
                  localStorage.setItem(`volumeVisualParams_${symbol}`, JSON.stringify(newParams));
                  if (candlesRef.current && candlesRef.current.length > 0) {
                    drawChart(candlesRef.current, lastPriceRef.current, null, null);
                  }
                }}
                style={{ width: '100%' }}
              />
              <small style={{ fontSize: '11px', color: '#999' }}>
                Mayor valor = solo volúmenes MUY excepcionales tendrán glow
              </small>

              <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px', marginTop: '10px' }}>
                Intensidad de Glow (blur): {volumeVisualParams.glowBlur}px
              </label>
              <input
                type="range"
                min="2"
                max="20"
                step="1"
                value={volumeVisualParams.glowBlur}
                onChange={(e) => {
                  const newParams = { ...volumeVisualParams, glowBlur: parseInt(e.target.value) };
                  setVolumeVisualParams(newParams);
                  localStorage.setItem(`volumeVisualParams_${symbol}`, JSON.stringify(newParams));
                  if (candlesRef.current && candlesRef.current.length > 0) {
                    drawChart(candlesRef.current, lastPriceRef.current, null, null);
                  }
                }}
                style={{ width: '100%' }}
              />
            </div>

            {/* 🎯 NUEVO: Sección de Clusters de Volumen Alto Consecutivo */}
            <div style={{ marginBottom: '25px' }}>
              <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#666' }}>
                Clusters de Volumen Alto Consecutivo
              </h4>

              {/* Toggle de activación */}
              <label style={{ display: 'flex', alignItems: 'center', marginBottom: '15px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={volumeVisualParams.clusterDetection}
                  onChange={(e) => {
                    const newParams = { ...volumeVisualParams, clusterDetection: e.target.checked };
                    setVolumeVisualParams(newParams);
                    localStorage.setItem(`volumeVisualParams_${symbol}`, JSON.stringify(newParams));
                    if (candlesRef.current && candlesRef.current.length > 0) {
                      drawChart(candlesRef.current, lastPriceRef.current, null, null);
                    }
                  }}
                  style={{ marginRight: '8px' }}
                />
                <span style={{ fontSize: '13px' }}>Destacar clusters de volumen alto</span>
              </label>

              {volumeVisualParams.clusterDetection && (
                <>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px' }}>
                    Mínimo de velas consecutivas: {volumeVisualParams.clusterMinBars}
                  </label>
                  <input
                    type="range"
                    min="2"
                    max="10"
                    step="1"
                    value={volumeVisualParams.clusterMinBars}
                    onChange={(e) => {
                      const newParams = { ...volumeVisualParams, clusterMinBars: parseInt(e.target.value) };
                      setVolumeVisualParams(newParams);
                      localStorage.setItem(`volumeVisualParams_${symbol}`, JSON.stringify(newParams));
                      if (candlesRef.current && candlesRef.current.length > 0) {
                        drawChart(candlesRef.current, lastPriceRef.current, null, null);
                      }
                    }}
                    style={{ width: '100%' }}
                  />
                  <small style={{ fontSize: '11px', color: '#999' }}>
                    Mayor valor = solo clusters más largos se destacarán
                  </small>

                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px', marginTop: '10px' }}>
                    Umbral promedio Z-Score: {volumeVisualParams.clusterThreshold.toFixed(1)}
                  </label>
                  <input
                    type="range"
                    min="0.0"
                    max="2.0"
                    step="0.1"
                    value={volumeVisualParams.clusterThreshold}
                    onChange={(e) => {
                      const newParams = { ...volumeVisualParams, clusterThreshold: parseFloat(e.target.value) };
                      setVolumeVisualParams(newParams);
                      localStorage.setItem(`volumeVisualParams_${symbol}`, JSON.stringify(newParams));
                      if (candlesRef.current && candlesRef.current.length > 0) {
                        drawChart(candlesRef.current, lastPriceRef.current, null, null);
                      }
                    }}
                    style={{ width: '100%' }}
                  />
                  <small style={{ fontSize: '11px', color: '#999' }}>
                    0 = cualquier volumen | 1 = volumen alto | 2 = volumen muy alto
                  </small>

                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px', marginTop: '15px' }}>
                    Colores de clusters:
                  </label>

                  {/* Color para clusters alcistas */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                    <span style={{ fontSize: '12px', color: '#666', width: '70px' }}>
                      Alcista:
                    </span>
                    <input
                      type="color"
                      value={volumeVisualParams.clusterColorBullish}
                      onChange={(e) => {
                        const newParams = { ...volumeVisualParams, clusterColorBullish: e.target.value };
                        setVolumeVisualParams(newParams);
                        localStorage.setItem(`volumeVisualParams_${symbol}`, JSON.stringify(newParams));
                        if (candlesRef.current && candlesRef.current.length > 0) {
                          drawChart(candlesRef.current, lastPriceRef.current, null, null);
                        }
                      }}
                      style={{
                        width: '50px',
                        height: '30px',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    />
                    <span style={{ fontSize: '12px', color: '#666' }}>
                      {volumeVisualParams.clusterColorBullish}
                    </span>
                  </div>

                  {/* Color para clusters bajistas */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '12px', color: '#666', width: '70px' }}>
                      Bajista:
                    </span>
                    <input
                      type="color"
                      value={volumeVisualParams.clusterColorBearish}
                      onChange={(e) => {
                        const newParams = { ...volumeVisualParams, clusterColorBearish: e.target.value };
                        setVolumeVisualParams(newParams);
                        localStorage.setItem(`volumeVisualParams_${symbol}`, JSON.stringify(newParams));
                        if (candlesRef.current && candlesRef.current.length > 0) {
                          drawChart(candlesRef.current, lastPriceRef.current, null, null);
                        }
                      }}
                      style={{
                        width: '50px',
                        height: '30px',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    />
                    <span style={{ fontSize: '12px', color: '#666' }}>
                      {volumeVisualParams.clusterColorBearish}
                    </span>
                  </div>
                  <small style={{ fontSize: '11px', color: '#999', display: 'block', marginTop: '8px' }}>
                    Los clusters se colorean según la dirección del precio (sube/baja)
                  </small>
                </>
              )}
            </div>

            {/* Botón de reset */}
            <button
              onClick={() => {
                // Los mismos valores con que arranca el volumen. La lista anterior no traía los colores de
                // cluster, y una vela en cluster rompía el dibujo del gráfico hasta recargar
                const defaultParams = { ...VOLUME_VISUAL_DEFAULTS };
                setVolumeVisualParams(defaultParams);
                localStorage.setItem(`volumeVisualParams_${symbol}`, JSON.stringify(defaultParams));
                if (candlesRef.current && candlesRef.current.length > 0) {
                  drawChart(candlesRef.current, lastPriceRef.current, null, null);
                }
              }}
              style={{
                width: '100%',
                padding: '10px',
                background: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 'bold'
              }}
            >
              🔄 Restaurar Valores por Defecto
            </button>
          </div>
        </div>
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
              onOpenVpSettings={onOpenVpSettings}
              onOpenRangeDetectionSettings={onOpenRangeDetectionSettings}
              onOpenRejectionPatternSettings={onOpenRejectionPatternSettings}
              onOpenSupportResistanceSettings={onOpenSupportResistanceSettings}
              rejectionPatternConfig={rejectionPatternConfig}
            />
          </div>
        </div>
      )}
    </>
  );
});

export default MiniChart;