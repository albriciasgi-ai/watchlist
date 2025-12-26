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

// ==================== LOGGING SYSTEM ====================
const DEBUG_MODE = true;

// ==================== CONFIGURACIÓN ====================
// Opacidad de los dibujos en el minichart (0.0 = transparente, 1.0 = opaco)
// Ajusta este valor si los dibujos no se ven bien en el minichart
const DRAWING_OPACITY = 0.7;

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

const MiniChart = ({ symbol, interval, days, indicatorStates, vpConfig, vpFixedRange, oiMode, externalIndicatorManager = null, onOpenVpSettings, onOpenRangeDetectionSettings, onOpenRejectionPatternSettings, onOpenSupportResistanceSettings, onOpenVWAPSettings, onOpenFibonacciSettings, onOpenContinuationPatternSettings, onOpenDoubleTopBottomSettings, rejectionPatternConfig }) => {
  const canvasRef = useRef(null);
  
  const candlesRef = useRef([]);
  const inProgressCandleRef = useRef(null);
  
  const lastPriceRef = useRef(null);
  const animationFrameRef = useRef(null);
  const mountedRef = useRef(true);
  const indicatorManagerRef = useRef(null);
  const drawingsRef = useRef([]);

  // ✅ NUEVO: Referencia para chequeo de gaps
  const gapCheckIntervalRef = useRef(null);
  
  const [mousePos, setMousePos] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenOiMode, setFullscreenOiMode] = useState(oiMode || "histogram");
  const [showFixedRangeManager, setShowFixedRangeManager] = useState(false);

  // Actualizar fullscreenOiMode cuando cambia oiMode del padre
  useEffect(() => {
    if (oiMode) {
      setFullscreenOiMode(oiMode);
    }
  }, [oiMode]);

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

      log.candle(symbol, `🎯 Fullscreen: zoom ajustado a ${viewStateRef.current.zoom.toFixed(2)} para ~${targetCandles} velas`);

      // Forzar redibujado
      setTimeout(() => {
        drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
      }, 100);
    }
  }, [isFullscreen]);
  const [fixedRangeProfiles, setFixedRangeProfiles] = useState([]);
  const [configuringProfileId, setConfiguringProfileId] = useState(null);
  const [currentProfileConfig, setCurrentProfileConfig] = useState(null);
  const [showChartModal, setShowChartModal] = useState(false);
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
        console.warn('Unknown shape type:', data.type);
        return null;
    }
  };

  const loadDrawings = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/drawings/${symbol}`);
      const data = await response.json();

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
      console.error(`Error loading drawings for ${symbol}:`, error);
      drawingsRef.current = [];
      setDrawingsVersion(v => v + 1); // Forzar re-render incluso en error
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

    // Render saved drawings (readonly, below candles)
    if (drawingsRef.current.length > 0) {
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

      // Render each drawing with configurable opacity for readonly
      ctx.globalAlpha = DRAWING_OPACITY;
      drawingsRef.current.forEach(shape => {
        try {
          shape.render(ctx, scaleConverter, false, false, false);
        } catch (error) {
          console.error('Error rendering shape:', error);
        }
      });
      ctx.globalAlpha = 1.0;
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

        // 🎯 Resetear escala de precios para recalcular con nuevos datos
        priceScaleRef.current.minPrice = null;
        priceScaleRef.current.maxPrice = null;

        // 🎯 Ajustar zoom inicial para mostrar el número deseado de velas
        // Minichart: ~573 velas, Fullscreen: ~1222 velas
        if (canvasRef.current) {
          const rect = canvasRef.current.getBoundingClientRect();
          const chartWidth = rect.width - 75; // Restar márgenes

          // Determinar número de velas deseado según tamaño del canvas
          // Si width > 1000px, es fullscreen, de lo contrario es minichart
          const targetCandles = chartWidth > 1000 ? 1222 : 573;

          // Calcular zoom necesario para mostrar ese número de velas
          // barWidth = 8 * zoom, candlesPerScreen = chartWidth / barWidth
          // targetCandles = chartWidth / (8 * zoom)
          // zoom = chartWidth / (targetCandles * 8)
          const calculatedZoom = chartWidth / (targetCandles * 8);
          viewStateRef.current.zoom = Math.max(0.1, Math.min(5, calculatedZoom));

          log.candle(symbol, `🎯 Zoom inicial ajustado: ${viewStateRef.current.zoom.toFixed(2)} para mostrar ~${targetCandles} velas`);
        }

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

  // ==================== MOUSE HANDLERS ====================
  
  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
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
    dragStateRef.current.isDragging = false;
    if (canvasRef.current) {
      canvasRef.current.style.cursor = 'crosshair';
    }
  };

  const handleMouseLeave = () => {
    dragStateRef.current.isDragging = false;
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

  const handleDoubleClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !candlesRef.current || candlesRef.current.length === 0) {
      // Si no hay canvas o datos, solo abrir ChartModal
      setShowChartModal(true);
      return;
    }

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
    } else {
      // 🎯 Doble click en cualquier otra área: abrir ChartModal
      setShowChartModal(true);
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
        console.log(`✅ Fixed Range guardado globalmente para todas las monedas:`, newRange);

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
      console.log(`✅ ${count} Fixed Range Profiles eliminados para ${symbol}`);
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
    console.log(`✅ Todos los VP Fixed Ranges eliminados GLOBALMENTE`);
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
    
    log.candle(symbol, '🚀 Componente montado, iniciando...');
    
    const initIndicators = async () => {
      // ✅ Si hay manager externo (fullscreen), usarlo directamente
      if (externalIndicatorManager) {
        console.log(`[${symbol}] 🔗 Usando IndicatorManager externo (fullscreen)`);
        indicatorManagerRef.current = externalIndicatorManager;

        // Sincronizar estados de indicadores visuales
        const profiles = externalIndicatorManager.getFixedRangeProfiles();
        setFixedRangeProfiles(profiles);

        // Agregar requestRedraw si no existe
        if (!externalIndicatorManager.requestRedraw) {
          externalIndicatorManager.requestRedraw = () => {
            if (candlesRef.current && candlesRef.current.length > 0) {
              console.log(`[${symbol}] 🔄 Redraw requested by indicator`);
              drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
            }
          };
        }

        log.indicator(symbol, '✅ IndicatorManager externo conectado');
        drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
        return; // NO crear nuevo manager
      }

      // ✅ Si no hay externo, crear nuevo (comportamiento normal)
      console.log(`[${symbol}] 🔧 Creando nuevo IndicatorManager`);
      indicatorManagerRef.current = new IndicatorManager(symbol, interval, parseInt(days));
      await indicatorManagerRef.current.initialize();

      // ✨ NUEVO: Agregar referencia a drawChart para que los indicadores puedan forzar redibujado
      indicatorManagerRef.current.requestRedraw = () => {
        if (candlesRef.current && candlesRef.current.length > 0) {
          console.log(`[${symbol}] 🔄 Redraw requested by indicator`);
          drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
        }
      };

      // 📋 Registrar en el registro global
      IndicatorManagerRegistry.register(symbol, indicatorManagerRef.current);

      // 🎛️ Aplicar presets globales con overrides por símbolo
      console.log(`[${symbol}] 🎛️ Aplicando presets efectivos (global + overrides)`);
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
        console.log(`[${symbol}] ✅ Sincronizados ${profiles.length} Fixed Range Profiles`);

        // ✅ NUEVO: Cargar rangos globales (aplicados a todas las monedas)
        const globalRanges = JSON.parse(localStorage.getItem('vp_fixed_ranges_global') || '[]');
        if (globalRanges.length > 0) {
          console.log(`[${symbol}] 📂 Cargando ${globalRanges.length} rangos globales`);
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
      log.indicator(symbol, '✅ Indicadores inicializados');
      drawChart(candlesRef.current, lastPriceRef.current, mousePos?.x, mousePos?.y);
    };
    
    loadHistoricalData();
    loadDrawings(); // Load saved drawings for this symbol
    initIndicators();

    const bybitInterval = getBybitInterval(interval);
    wsManager.connect(bybitInterval);
    wsManager.subscribe(symbol, handleWebSocketMessage);
    
    log.ws(symbol, `Suscrito a WebSocket @ ${bybitInterval}`);

    // ✅ REDUCIDO: Recarga cada 5 minutos (el auto-refresh de indicadores se hace cada 1 min)
    const reloadInterval = setInterval(() => {
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
    const patternDetectionInterval = setInterval(async () => {
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
        log.candle(symbol, '🛑 Componente desmontado, limpiando...');

        // 📋 Desregistrar del registro global
        IndicatorManagerRegistry.unregister(symbol);

        mountedRef.current = false;
        wsManager.unsubscribe(symbol, handleWebSocketMessage);

        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }

        clearInterval(reloadInterval);

        // ✅ NUEVO: Limpiar intervalos de gap check
        if (gapCheckIntervalRef.current) {
          clearInterval(gapCheckIntervalRef.current);
        }

        // 🎯 NUEVO: Limpiar intervalo de detección de patrones
        if (patternDetectionInterval) {
          clearInterval(patternDetectionInterval);
        }

        // ✅ NUEVO: Destruir IndicatorManager correctamente (solo si no es externo)
        if (indicatorManagerRef.current) {
          indicatorManagerRef.current.destroy();
        }

        candlesRef.current = [];
        inProgressCandleRef.current = null;

        if (canvas) {
          canvas.removeEventListener('wheel', preventScroll);
          canvas.removeEventListener('dblclick', handleDoubleClick);
        }
      } else {
        console.log(`[${symbol}] ⏭️ Skipping cleanup (external manager)`);
      }
    };
  }, [symbol, interval, days, indicatorStates, externalIndicatorManager]);

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
          console.log(`[${symbol}] 📥 Creando Fixed Range desde evento global`);
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
        console.log(`[${symbol}] 🗑️ Eliminando todos los VP Fixed Ranges (evento global)`);
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
      <div className="mini-chart">
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
          style={{ cursor: 'crosshair', display: 'block', touchAction: 'none' }}
        />
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
              onDeleteAllProfiles={handleDeleteAllFixedRangeProfiles}
              onDeleteAllProfilesGlobal={handleDeleteAllFixedRangeProfilesGlobal}
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
              onOpenVpSettings={onOpenVpSettings}
              onOpenRangeDetectionSettings={onOpenRangeDetectionSettings}
              onOpenRejectionPatternSettings={onOpenRejectionPatternSettings}
              onOpenSupportResistanceSettings={onOpenSupportResistanceSettings}
              onOpenVWAPSettings={onOpenVWAPSettings}
              onOpenFibonacciSettings={onOpenFibonacciSettings}
              onOpenContinuationPatternSettings={onOpenContinuationPatternSettings}
              onOpenDoubleTopBottomSettings={onOpenDoubleTopBottomSettings}
              rejectionPatternConfig={rejectionPatternConfig}
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