// src/components/MiniChart.jsx
// ✅ SOLUCIÓN COMPLETA: Sincronización automática de indicadores + Detección de gaps + Zoom Dinámico + Presets

import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { API_BASE_URL } from "../config";
import wsManager from "./WebSocketManager";
import IndicatorManager from "./indicators/IndicatorManager";
import FixedRangeProfilesManager from "./FixedRangeProfilesManager";
import VolumeProfileFixedSettings from "./VolumeProfileFixedSettings";
import ZoomPresetsConfig from "./ZoomPresetsConfig";
import DrawingToolManager from "./drawing/DrawingToolManager";
import MeasurementTool from "./drawing/MeasurementTool";
import TPSLBox from "./drawing/shapes/TPSLBox"; // 🎯 Para crear cajas TP/SL programáticamente

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

const MiniChart = forwardRef(({
  symbol,
  interval,
  days,
  indicatorStates,
  vpConfig,
  vpFixedRange,
  oiMode,
  onOpenVpSettings,
  onOpenRangeDetectionSettings,
  onOpenRejectionPatternSettings,
  onOpenSupportResistanceSettings,
  onOpenVWAPSettings,
  onOpenDoubleTopBottomSettings,
  onOpenSwingDetectorSettings,
  rejectionPatternConfig,
  // 🎯 NUEVO: Props para modo backtesting
  backtestingMode = false,
  backtestingData = null,
  currentTime = null,
  onRequestPause = null,  // 🎯 NUEVO: Callback para pausar reproducción al hacer paneo
  // 🎯 NUEVO: Props para drawing tools
  currentTool = 'select',
  onToolChange = null,
  onDrawingsChange = null  // 🔧 FIX: Callback para sincronizar dibujos entre tabs
}, ref) => {
  const canvasRef = useRef(null);

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

  // Actualizar fullscreenOiMode cuando cambia oiMode del padre
  useEffect(() => {
    if (oiMode) {
      setFullscreenOiMode(oiMode);
    }
  }, [oiMode]);

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
      // Delete: borrar shape seleccionado
      if (e.key === 'Delete' && drawingManagerRef.current) {
        drawingManagerRef.current.deleteSelected();
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
    // 🎯 NUEVO: Obtener el IndicatorManager (para acceso directo desde BacktestingApp)
    getIndicatorManager: () => {
      return indicatorManagerRef.current;
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

      // Usar TP/SL de la orden si se proporcionan
      if (stopLoss !== null && stopLoss !== undefined) {
        box.slPrice = stopLoss;
      }
      if (takeProfit !== null && takeProfit !== undefined) {
        box.tpPrice = takeProfit;
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
        entry: entryPrice,
        sl: box.slPrice,
        tp: box.tpPrice,
        direction,
        width: candleWidthCount
      });

      return box.id;
    }
  }), [symbol, interval]);

  const [fixedRangeProfiles, setFixedRangeProfiles] = useState([]);
  const [configuringProfileId, setConfiguringProfileId] = useState(null);
  const [currentProfileConfig, setCurrentProfileConfig] = useState(null);
  const viewStateRef = useRef({ offset: 0, zoom: 1, verticalOffset: 0, verticalZoom: 1 });
  const dragStateRef = useRef({ isDragging: false, startX: 0, startY: 0, startOffset: 0, startVerticalOffset: 0 });
  const manualPanRef = useRef(false); // 🎯 NUEVO: Detectar si el usuario hizo paneo manual
  const rafRef = useRef(null); // Para requestAnimationFrame
  const allCandlesRef = useRef([]); // Almacena todas las velas para binary search
  const lastIndexRef = useRef(-1); // Para detectar cambios reales de vela
  const initialRenderDoneRef = useRef(false); // Para forzar primer render cuando se carga currentTime
  const lastRenderTimeRef = useRef(0); // Para throttling agresivo

  // 🎯 NUEVO: Estados para sistema de presets de zoom
  const [showPresetsConfig, setShowPresetsConfig] = useState(false);
  const [zoomPresets, setZoomPresets] = useState([]);
  const [activePreset, setActivePreset] = useState(null);

  // 🎯 NUEVO: Estado para divisor redimensionable (proporción de altura del precio chart)
  const [priceChartRatio, setPriceChartRatio] = useState(() => {
    const saved = localStorage.getItem(`priceChartRatio_${symbol}`);
    return saved ? parseFloat(saved) : 0.65; // 65% por defecto
  });
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);

  const getBybitInterval = (interval) => {
    const map = {
      "1": "1", "3": "3", "5": "5", "15": "15", "30": "30",
      "60": "60", "120": "120", "240": "240", "D": "D", "W": "W"
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

    let desiredIndicatorsHeight = 0;
    if (indicatorManagerRef.current) {
      desiredIndicatorsHeight = indicatorManagerRef.current.getTotalHeight();
    }

    const availableHeight = height - marginTop - timeAxisHeight;

    // 🎯 FIX: Si no hay indicadores activos, el gráfico de precio ocupa todo el espacio disponible
    // excepto el volumen. Esto evita el espacio vacío cuando se quitan indicadores.
    let priceChartHeight, volumeHeight, indicatorsHeight, heightScale;

    if (desiredIndicatorsHeight === 0) {
      // Sin indicadores: el gráfico ocupa todo excepto volumen
      volumeHeight = Math.min(baseVolumeHeight, Math.floor(availableHeight * 0.1));
      indicatorsHeight = 0;
      priceChartHeight = availableHeight - volumeHeight;
      heightScale = 1.0;
    } else {
      // Con indicadores: usar ratio definido por el usuario
      priceChartHeight = Math.floor(availableHeight * priceChartRatio);
      const remainingHeight = availableHeight - priceChartHeight;

      // Dividir el espacio restante entre volume e indicadores
      volumeHeight = Math.min(baseVolumeHeight, Math.floor(remainingHeight * 0.15)); // 15% del restante
      indicatorsHeight = remainingHeight - volumeHeight;

      // Calcular heightScale para indicadores
      heightScale = indicatorsHeight / desiredIndicatorsHeight;

      // Asegurar que no se pase del espacio disponible
      if (priceChartHeight + volumeHeight + indicatorsHeight > availableHeight) {
        priceChartHeight = availableHeight - volumeHeight - indicatorsHeight;
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
    const candlesPerScreen = Math.floor(chartWidth / (8 * viewStateRef.current.zoom));
    const maxOffset = Math.max(0, displayCandles.length - candlesPerScreen);
    const offset = Math.min(viewStateRef.current.offset, maxOffset);
    
    const startIdx = Math.max(0, displayCandles.length - candlesPerScreen - offset);
    const endIdx = Math.min(displayCandles.length, startIdx + candlesPerScreen);
    const visibleCandles = displayCandles.slice(startIdx, endIdx);

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);

    if (visibleCandles.length === 0) return;

    // 🎯 MODIFICADO: En modo backtesting usar velas VISIBLES, en modo normal usar TODAS
    // - Backtesting: Queremos ver detalle de la acción del precio visible
    // - Normal: Evitamos auto-zoom durante paneo (mantiene contexto)
    const candlesForPriceRange = backtestingMode ? visibleCandles : displayCandles;
    const minPrice = Math.min(...candlesForPriceRange.map(d => d.low));
    const maxPrice = Math.max(...candlesForPriceRange.map(d => d.high));
    const priceRange = maxPrice - minPrice;

    // 🎯 NUEVO: Aplicar zoom vertical (Ctrl + rueda del mouse) y offset vertical (paneo)
    const verticalZoom = viewStateRef.current.verticalZoom || 1;
    const verticalOffset = viewStateRef.current.verticalOffset || 0;
    const baseYScale = priceRange > 0 ? priceChartHeight / priceRange : 1;
    const yScale = baseYScale * verticalZoom;

    const maxVolume = Math.max(...visibleCandles.map(d => d.volume));
    const volumeScale = maxVolume > 0 ? volumeHeight / maxVolume : 1;

    const barWidth = chartWidth / visibleCandles.length;

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

      // 🎯 NUEVO: Pasar información de zoom vertical, offset y rango de precios
      // 🎯 Función para convertir timestamp a coordenada X
      const timeToX = (timestamp) => {
        // Buscar índice de la vela con este timestamp en visibleCandles
        const index = visibleCandles.findIndex(c => c.timestamp === timestamp);
        if (index === -1) return null; // Vela no visible
        return marginLeft + (index * barWidth) + (barWidth / 2);
      };

      const priceContext = {
        minPrice,
        maxPrice,
        priceRange,
        verticalZoom,
        verticalOffset,
        yScale,
        priceToY,  // ✨ Función para que los indicadores puedan convertir precios a coordenadas Y
        timeToX    // ✨ Función para convertir timestamp a coordenada X
      };

      // 🎯 OPTIMIZACIÓN: En modo backtesting, pasar TODAS las velas para pre-cálculo
      // Los indicadores usarán esto para calcular UNA VEZ, luego solo dibujarán visibleCandles
      // IMPORTANTE: SIEMPRE usar allCandlesRef en backtesting, incluso cuando está pausado
      const allCandlesForCalculation = backtestingMode && allCandlesRef.current && allCandlesRef.current.length > 0
        ? allCandlesRef.current
        : displayCandles;

      // Debug: Detectar si allCandlesForCalculation está vacío
      if (!allCandlesForCalculation || allCandlesForCalculation.length === 0) {
        console.error(`[MiniChart ${symbol} ${interval}] ⚠️ CRÍTICO: allCandlesForCalculation está vacío!`);
        console.error(`  backtestingMode: ${backtestingMode}`);
        console.error(`  allCandlesRef.current: ${allCandlesRef.current ? allCandlesRef.current.length : 'null/undefined'}`);
        console.error(`  displayCandles: ${displayCandles.length}`);
      }

      // Renderizar overlays
      if (allCandlesForCalculation && allCandlesForCalculation.length > 0) {
        indicatorManagerRef.current.renderOverlays(ctx, overlayBounds, visibleCandles, allCandlesForCalculation, priceContext);
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

    // 🎯 NUEVO: Crosshair estilo TradingView - mostrar info en los ejes
    if (mouseX !== null && mouseY !== null) {
      // Línea vertical del crosshair
      if (mouseX >= marginLeft && mouseX <= width - marginRight) {
        ctx.strokeStyle = "#999";
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

        ctx.strokeStyle = "#999";
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

  // ==================== DRAWING PERSISTENCE ====================

  const loadDrawings = async () => {
    if (!drawingManagerRef.current) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/drawings/${symbol}`);
      const data = await response.json();

      if (data.shapes && data.shapes.length > 0) {
        drawingManagerRef.current.loadShapes(data.shapes);
        console.log(`[${symbol}] ✅ Cargados ${data.shapes.length} dibujos`);

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
      const candlesPerScreen = Math.floor(chartWidth / (8 * viewStateRef.current.zoom));
      const deltaCandlesFloat = (deltaX / chartWidth) * candlesPerScreen;
      const deltaCandles = Math.round(deltaCandlesFloat);

      const maxOffset = Math.max(0, candlesRef.current.length - candlesPerScreen);
      const newOffset = Math.max(0, Math.min(maxOffset, dragStateRef.current.startOffset + deltaCandles));
      viewStateRef.current.offset = newOffset;

      // Paneo vertical
      const deltaY = y - dragStateRef.current.startY;
      const newVerticalOffset = dragStateRef.current.startVerticalOffset + deltaY;
      viewStateRef.current.verticalOffset = newVerticalOffset;

      drawChart(candlesRef.current, lastPriceRef.current, null, null);
    } else {
      setMousePos({ x, y });
      drawChart(candlesRef.current, lastPriceRef.current, x, y);
    }
  };

  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 🎯 NUEVO: Usar el scaleConverter guardado del último render
    const scaleConverter = scaleConverterRef.current;

    // 🎯 NUEVO: Middle click para measurement tool
    if (e.button === 1 && measurementToolRef.current && scaleConverter) {
      measurementToolRef.current.handleMouseDown(x, y, scaleConverter);
      drawChart(candlesRef.current, lastPriceRef.current, null, null);
      return;
    }

    // 🎯 NUEVO: Left click para drawing manager
    if (e.button === 0 && drawingManagerRef.current && scaleConverter) {
      const handled = drawingManagerRef.current.handleMouseDown(x, y, scaleConverter);

      if (handled) {
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

  const handleMouseUp = () => {
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

    // 🔧 FIX: Limpiar potentialDrag
    dragStateRef.current.isDragging = false;
    dragStateRef.current.potentialDrag = false;
    if (canvasRef.current) {
      canvasRef.current.style.cursor = 'crosshair';
    }
  };

  const handleMouseLeave = () => {
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

    // 🎯 NUEVO: Calcular límite mínimo de zoom dinámicamente
    // Esto permite ver TODAS las velas disponibles sin límite artificial
    const totalCandles = candlesRef.current.length;
    const minCandleWidth = 0.3; // píxeles mínimos por vela para mantener visibilidad
    const chartWidthForZoom = canvas.getBoundingClientRect().width - 75;

    // Calcular el zoom mínimo necesario para mostrar todas las velas
    // Si tenemos 2000 velas y 800px de ancho: minZoom = (800 / (8 * 2000)) = 0.05
    const dynamicMinZoom = (chartWidthForZoom / (8 * totalCandles)) * 0.8; // 0.8 para dar margen
    const absoluteMinZoom = minCandleWidth / 8; // 0.0375 (nunca menos de 0.3px por vela)
    const minZoom = Math.max(dynamicMinZoom, absoluteMinZoom);

    // Límite máximo sigue siendo 5 (zoom in extremo)
    const maxZoom = 5;

    const newZoom = Math.max(minZoom, Math.min(maxZoom, oldZoom * zoomFactor));
    viewStateRef.current.zoom = newZoom;

    // Desmarcar preset activo si el usuario hace zoom manual
    if (activePreset !== null) {
      setActivePreset(null);
    }

    // Ajustar offset para mantener la vista coherente
    const rect = canvas.getBoundingClientRect();
    const chartWidth = rect.width - 75;
    const candlesPerScreen = Math.floor(chartWidth / (8 * newZoom));
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

    // 🎯 Verificar si el doble click fue en el área del eje de precios (derecha)
    const isInPriceAxis = x >= (width - marginRight) && x <= width;
    const isInPriceChartArea = y >= marginTop && y <= (marginTop + priceChartHeight);

    if (isInPriceAxis && isInPriceChartArea) {
      // 🎯 Auto-scale vertical: resetear zoom y offset para llenar la ventana
      viewStateRef.current.verticalZoom = 1;
      viewStateRef.current.verticalOffset = 0;

      drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
    }
  };

  // ==================== FIXED RANGE PROFILES ====================
  
  const handleCreateFixedRangeProfile = (startTimestamp, endTimestamp) => {
    if (indicatorManagerRef.current) {
      const rangeId = indicatorManagerRef.current.createFixedRangeProfile(startTimestamp, endTimestamp);
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
    // Reset del flag cuando cambia el interval o backtestingData
    initialRenderDoneRef.current = false;
    lastIndexRef.current = -1; // 🎯 CRÍTICO: Reset para forzar re-render en próximo Binary Search

    if (!backtestingMode || !backtestingData) {
      console.log(`[MiniChart ${symbol} ${interval}] No hay datos de backtesting aún`);
      return;
    }
    const timeframeData = backtestingData.timeframes?.[interval];

    if (timeframeData?.main) {
      console.log(`[MiniChart ${symbol} ${interval}] 📊 Cargando ${timeframeData.main.length} velas en allCandlesRef`);
      allCandlesRef.current = timeframeData.main;

      // 🎯 ELIMINADO: Ya NO reseteamos el caché del VWAP
      // El VWAP detecta automáticamente cambios en allCandles.length y se recalcula si es necesario
    } else {
      console.warn(`[MiniChart ${symbol} ${interval}] ⚠️ No hay datos main en timeframe ${interval}`);
    }
  }, [backtestingMode, backtestingData, interval, symbol]);

  // 🎯 ELIMINADO - Ya no es necesario, el Binary Search maneja todo desde el inicio

  // 🎯 OPTIMIZADO: Efecto para modo backtesting - filtrar velas con Binary Search
  useEffect(() => {
    // IMPORTANTE: Solo ejecutar en modo backtesting con datos disponibles
    if (!backtestingMode || !backtestingData || allCandlesRef.current.length === 0) return;
    if (!currentTime) return;

    // Binary search: encontrar último índice donde timestamp <= currentTime
    let left = 0;
    let right = allCandlesRef.current.length - 1;
    let lastIndex = -1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (allCandlesRef.current[mid].timestamp <= currentTime) {
        lastIndex = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    // Solo actualizar si el índice cambió (nueva vela)
    if (lastIndex < 0 || lastIndex === lastIndexRef.current) return;

    // Actualizar refs
    lastIndexRef.current = lastIndex;

    // Usar slice en lugar de filter
    candlesRef.current = allCandlesRef.current.slice(0, lastIndex + 1);
    inProgressCandleRef.current = null;

    // Actualizar precio actual
    const lastCandle = candlesRef.current[candlesRef.current.length - 1];
    if (lastCandle) {
      lastPriceRef.current = lastCandle.close;
    }

    // Ajustar offset si no hay paneo manual
    if (!manualPanRef.current && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const chartWidth = rect.width - 75;
      const zoom = viewStateRef.current.zoom || 1;
      const candlesPerScreen = Math.floor(chartWidth / (8 * zoom));
      const marginRightPx = chartWidth * 0.35;
      const candlesInMargin = Math.ceil(marginRightPx / (8 * zoom));

      if (candlesRef.current.length > candlesPerScreen) {
        viewStateRef.current.offset = Math.min(candlesInMargin, candlesRef.current.length - candlesPerScreen);
      } else {
        viewStateRef.current.offset = 0;
      }
    }

    // 🎯 CRITICAL: Throttle agresivo para alta velocidad
    // Limitar renders a 10 FPS (100ms) para evitar saturar el navegador
    const now = performance.now();
    const timeSinceLastRender = now - lastRenderTimeRef.current;

    // Si han pasado menos de 100ms, cancelar render anterior y programar nuevo
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    if (timeSinceLastRender < 100) {
      // Throttle: esperar 100ms desde el último render
      rafRef.current = requestAnimationFrame(() => {
        const checkTime = performance.now();
        if (checkTime - lastRenderTimeRef.current >= 100) {
          lastRenderTimeRef.current = checkTime;
          drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
        }
      });
    } else {
      // Render inmediato si ya pasaron 100ms
      lastRenderTimeRef.current = now;
      rafRef.current = requestAnimationFrame(() => {
        drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
      });
    }
  }, [backtestingMode, backtestingData, currentTime, interval]);

  // ==================== MAIN EFFECT ====================

  useEffect(() => {
    mountedRef.current = true;

    log.candle(symbol, '🚀 Componente montado, iniciando...');

    const initIndicators = async () => {
      indicatorManagerRef.current = new IndicatorManager(symbol, interval, parseInt(days));

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

      await indicatorManagerRef.current.initialize(backtestingMode);

      // ✨ NUEVO: Agregar referencia a drawChart para que los indicadores puedan forzar redibujado
      indicatorManagerRef.current.requestRedraw = () => {
        if (candlesRef.current && candlesRef.current.length > 0) {
          console.log(`[${symbol}] 🔄 Redraw requested by indicator`);
          drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
        }
      };

      // 🎯 FIX: Usar updateIndicatorStates para que haga fetchData de S/R y otros
      if (indicatorStates) {
        await indicatorManagerRef.current.updateIndicatorStates(indicatorStates, backtestingMode);
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
      wsManager.connect(bybitInterval);
      wsManager.subscribe(symbol, handleWebSocketMessage);

      log.ws(symbol, `Suscrito a WebSocket @ ${bybitInterval}`);
    }

    initIndicators();

    // 🎯 NUEVO: Inicializar sistema de dibujo
    drawingManagerRef.current = new DrawingToolManager(symbol, interval);
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
        wsManager.unsubscribe(symbol, handleWebSocketMessage);
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
    indicatorManagerRef.current.updateIndicatorStates(indicatorStates, backtestingMode)
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

  // 🎯 NUEVO: Handlers para divisor redimensionable
  const handleDividerMouseDown = (e) => {
    e.preventDefault();
    setIsDraggingDivider(true);
  };

  const handleDividerMouseMove = (e) => {
    if (!isDraggingDivider || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const newRatio = Math.max(0.3, Math.min(0.85, mouseY / rect.height)); // Entre 30% y 85%

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
            ⚙️
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
              ⛶
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
              📍 Follow
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
            top: `${priceChartRatio * 100}%`,
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