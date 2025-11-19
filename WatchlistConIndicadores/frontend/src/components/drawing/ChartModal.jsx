// src/components/drawing/ChartModal.jsx
// Modal fullscreen para análisis de gráficos con herramientas de dibujo

import React, { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE_URL } from "../../config";
import DrawingToolManager from "./DrawingToolManager";
import DrawingToolbar from "./DrawingToolbar";
import MeasurementTool from "./MeasurementTool";
import "./ChartModal.css";

const ChartModal = ({ symbol, interval, days, onClose }) => {
  const canvasRef = useRef(null);
  const drawingManagerRef = useRef(null);
  const measurementToolRef = useRef(null);
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTool, setSelectedTool] = useState('select');
  const [needsRedraw, setNeedsRedraw] = useState(false);

  // View state para pan y zoom
  const viewStateRef = useRef({
    offset: 0,
    zoom: 1,
    verticalZoom: 1,
    verticalOffset: 0,
    minPrice: 0,
    maxPrice: 0,
    priceRange: 0
  });

  const dragStateRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    startOffset: 0,
    startVerticalOffset: 0
  });

  // Inicializar managers
  useEffect(() => {
    drawingManagerRef.current = new DrawingToolManager(symbol, interval);
    measurementToolRef.current = new MeasurementTool();

    // Cargar dibujos guardados
    loadDrawings();
  }, [symbol, interval]);

  // Cargar datos históricos
  useEffect(() => {
    loadHistoricalData();
  }, [symbol, interval, days]);

  const loadHistoricalData = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${API_BASE_URL}/api/historical/${symbol}?interval=${interval}&days=${days}`
      );
      const data = await response.json();
      setCandles(data);
      setLoading(false);
    } catch (error) {
      console.error('Error loading historical data:', error);
      setLoading(false);
    }
  };

  const loadDrawings = async () => {
    if (!drawingManagerRef.current) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/drawings/${symbol}`
      );
      const data = await response.json();

      if (data.shapes) {
        drawingManagerRef.current.loadShapes(data.shapes);
        setNeedsRedraw(true);
      }
    } catch (error) {
      console.error('Error loading drawings:', error);
    }
  };

  const saveDrawings = async () => {
    if (!drawingManagerRef.current) return;

    try {
      const shapes = drawingManagerRef.current.getShapes();
      await fetch(`${API_BASE_URL}/api/drawings/${symbol}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interval: interval,
          shapes: shapes
        })
      });
    } catch (error) {
      console.error('Error saving drawings:', error);
    }
  };

  // Manejo de eventos del mouse
  const handleMouseDown = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Measurement tool (middle click)
    if (e.button === 1 && measurementToolRef.current) {
      e.preventDefault();
      measurementToolRef.current.handleMouseDown(e, canvas);
      setNeedsRedraw(true);
      return;
    }

    // Drawing tools
    if (e.button === 0 && drawingManagerRef.current) {
      const scaleConverter = calculateScaleConverter();
      const consumed = drawingManagerRef.current.handleMouseDown(
        x, y, scaleConverter, selectedTool
      );

      if (consumed) {
        setNeedsRedraw(true);
        return;
      }

      // Pan mode (si no hay herramienta activa)
      if (selectedTool === 'select') {
        dragStateRef.current = {
          isDragging: true,
          startX: x,
          startY: y,
          startOffset: viewStateRef.current.offset,
          startVerticalOffset: viewStateRef.current.verticalOffset
        };
      }
    }
  }, [selectedTool]);

  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Measurement tool
    if (measurementToolRef.current && measurementToolRef.current.isMeasuring) {
      measurementToolRef.current.handleMouseMove(e, canvas);
      setNeedsRedraw(true);
      return;
    }

    // Drawing tools
    if (drawingManagerRef.current) {
      const scaleConverter = calculateScaleConverter();
      const consumed = drawingManagerRef.current.handleMouseMove(x, y, scaleConverter);

      if (consumed) {
        setNeedsRedraw(true);
        return;
      }
    }

    // Pan mode
    if (dragStateRef.current.isDragging) {
      const deltaX = x - dragStateRef.current.startX;
      const chartWidth = canvas.width - 75; // margins
      const candlesPerScreen = Math.floor(chartWidth / (8 * viewStateRef.current.zoom));
      const pixelsPerCandle = chartWidth / candlesPerScreen;
      const candleDelta = Math.floor(deltaX / pixelsPerCandle);

      viewStateRef.current.offset = Math.max(0, dragStateRef.current.startOffset - candleDelta);

      // Vertical pan
      const deltaY = y - dragStateRef.current.startY;
      viewStateRef.current.verticalOffset = dragStateRef.current.startVerticalOffset + deltaY;

      setNeedsRedraw(true);
    }
  }, []);

  const handleMouseUp = useCallback((e) => {
    if (measurementToolRef.current) {
      measurementToolRef.current.handleMouseUp(e);
    }

    if (drawingManagerRef.current) {
      const scaleConverter = calculateScaleConverter();
      drawingManagerRef.current.handleMouseUp(scaleConverter);
      saveDrawings(); // Auto-guardar
    }

    dragStateRef.current.isDragging = false;
    setNeedsRedraw(true);
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();

    if (e.ctrlKey) {
      // Vertical zoom
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      viewStateRef.current.verticalZoom *= delta;
      viewStateRef.current.verticalZoom = Math.max(0.1, Math.min(10, viewStateRef.current.verticalZoom));
    } else {
      // Horizontal zoom
      const delta = e.deltaY > 0 ? 1.1 : 0.9;
      viewStateRef.current.zoom *= delta;
      viewStateRef.current.zoom = Math.max(0.5, Math.min(5, viewStateRef.current.zoom));
    }

    setNeedsRedraw(true);
  }, []);

  const handleKeyDown = useCallback((e) => {
    // Esc - Cancelar/Cerrar
    if (e.key === 'Escape') {
      if (drawingManagerRef.current && drawingManagerRef.current.isDrawing()) {
        drawingManagerRef.current.cancelDrawing();
        setNeedsRedraw(true);
      } else {
        onClose();
      }
    }

    // Shortcuts de herramientas
    if (e.key === 't' || e.key === 'T') setSelectedTool('trendline');
    if (e.key === 'h' || e.key === 'H') setSelectedTool('horizontal');
    if (e.key === 'r' || e.key === 'R') setSelectedTool('rectangle');
    if (e.key === 'f' || e.key === 'F') setSelectedTool('fibonacci');
    if (e.key === 'v' || e.key === 'V') setSelectedTool('select');

    // Delete - Borrar seleccionado
    if (e.key === 'Delete' && drawingManagerRef.current) {
      drawingManagerRef.current.deleteSelected();
      saveDrawings();
      setNeedsRedraw(true);
    }

    // Ctrl+Z - Undo
    if (e.ctrlKey && e.key === 'z' && drawingManagerRef.current) {
      drawingManagerRef.current.undo();
      saveDrawings();
      setNeedsRedraw(true);
    }

    // Ctrl+Y - Redo
    if (e.ctrlKey && e.key === 'y' && drawingManagerRef.current) {
      drawingManagerRef.current.redo();
      saveDrawings();
      setNeedsRedraw(true);
    }
  }, [onClose]);

  // Event listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    document.addEventListener('keydown', handleKeyDown);

    // Prevenir comportamiento default del middle click
    const handleAuxClick = (e) => {
      if (e.button === 1) e.preventDefault();
    };
    canvas.addEventListener('auxclick', handleAuxClick);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('auxclick', handleAuxClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleMouseDown, handleMouseMove, handleMouseUp, handleWheel, handleKeyDown]);

  // Función helper para calcular conversión de escalas
  const calculateScaleConverter = () => {
    const canvas = canvasRef.current;
    if (!canvas || candles.length === 0) return null;

    const width = canvas.width;
    const height = canvas.height;
    const marginLeft = 10;
    const marginRight = 65;
    const marginTop = 25;
    const marginBottom = 100;

    const chartWidth = width - marginLeft - marginRight;
    const chartHeight = height - marginTop - marginBottom;

    const candlesPerScreen = Math.floor(chartWidth / (8 * viewStateRef.current.zoom));
    const startIdx = Math.max(0, candles.length - candlesPerScreen - viewStateRef.current.offset);
    const endIdx = Math.min(candles.length, startIdx + candlesPerScreen);
    const visibleCandles = candles.slice(startIdx, endIdx);

    const minPrice = Math.min(...candles.map(c => c.low));
    const maxPrice = Math.max(...candles.map(c => c.high));
    const priceRange = maxPrice - minPrice;

    return {
      candles,
      visibleCandles,
      startIdx,
      endIdx,
      minPrice,
      maxPrice,
      priceRange,
      verticalZoom: viewStateRef.current.verticalZoom,
      verticalOffset: viewStateRef.current.verticalOffset,
      chartWidth,
      chartHeight,
      marginLeft,
      marginTop,
      interval,

      // Conversiones
      priceToY: (price) => {
        const baseYScale = priceRange > 0 ? chartHeight / priceRange : 1;
        const yScale = baseYScale * viewStateRef.current.verticalZoom;
        return marginTop + chartHeight - (price - minPrice) * yScale + viewStateRef.current.verticalOffset;
      },

      yToPrice: (y) => {
        const baseYScale = priceRange > 0 ? chartHeight / priceRange : 1;
        const yScale = baseYScale * viewStateRef.current.verticalZoom;
        const relativeY = y - marginTop - viewStateRef.current.verticalOffset;
        return maxPrice - (relativeY / yScale);
      },

      timeToX: (timestamp) => {
        const candleIndex = candles.findIndex(c => c.timestamp === timestamp);
        if (candleIndex === -1) return null;
        const relativeIndex = candleIndex - startIdx;
        if (relativeIndex < 0 || relativeIndex >= visibleCandles.length) return null;
        const barWidth = chartWidth / visibleCandles.length;
        return marginLeft + (relativeIndex * barWidth) + (barWidth / 2);
      },

      xToTime: (x) => {
        const relativeX = x - marginLeft;
        const barWidth = chartWidth / visibleCandles.length;
        const candleIndex = startIdx + Math.floor(relativeX / barWidth);
        return candles[candleIndex]?.timestamp || null;
      }
    };
  };

  // Renderizado del chart
  useEffect(() => {
    if (needsRedraw || candles.length > 0) {
      drawChart();
      setNeedsRedraw(false);
    }
  }, [candles, needsRedraw]);

  const drawChart = () => {
    const canvas = canvasRef.current;
    if (!canvas || candles.length === 0) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Fondo blanco
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    const scaleConverter = calculateScaleConverter();
    if (!scaleConverter) return;

    const { visibleCandles, chartWidth, chartHeight, marginLeft, marginTop, marginBottom = 100 } = scaleConverter;

    // Grid
    ctx.strokeStyle = '#E0E0E0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = marginTop + (chartHeight * i / 4);
      ctx.beginPath();
      ctx.moveTo(marginLeft, y);
      ctx.lineTo(marginLeft + chartWidth, y);
      ctx.stroke();
    }

    // Renderizar DIBUJOS (debajo de las velas según tu preferencia)
    if (drawingManagerRef.current) {
      drawingManagerRef.current.render(ctx, scaleConverter);
    }

    // Candles
    const barWidth = chartWidth / visibleCandles.length;
    const bullColor = '#10B981'; // Verde más claro
    const bearColor = '#EF4444'; // Rojo más claro

    visibleCandles.forEach((candle, i) => {
      const x = marginLeft + (i * barWidth);
      const yOpen = scaleConverter.priceToY(candle.open);
      const yClose = scaleConverter.priceToY(candle.close);
      const yHigh = scaleConverter.priceToY(candle.high);
      const yLow = scaleConverter.priceToY(candle.low);

      const color = candle.close >= candle.open ? bullColor : bearColor;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;

      // Wick
      ctx.beginPath();
      ctx.moveTo(x + barWidth / 2, yHigh);
      ctx.lineTo(x + barWidth / 2, yLow);
      ctx.stroke();

      // Body
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

    // Price axis labels
    ctx.fillStyle = '#666666';
    ctx.font = '11px Arial';
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const price = scaleConverter.minPrice + (scaleConverter.priceRange * i / 4);
      const y = scaleConverter.priceToY(price);
      ctx.fillText(price.toFixed(2), marginLeft + chartWidth + 5, y + 4);
    }

    // Measurement tool (encima de todo)
    if (measurementToolRef.current) {
      measurementToolRef.current.render(ctx, scaleConverter);
    }
  };

  const handleToolChange = (tool) => {
    setSelectedTool(tool);
    if (drawingManagerRef.current) {
      drawingManagerRef.current.setTool(tool);
    }
  };

  const handleUndo = () => {
    if (drawingManagerRef.current) {
      drawingManagerRef.current.undo();
      saveDrawings();
      setNeedsRedraw(true);
    }
  };

  const handleRedo = () => {
    if (drawingManagerRef.current) {
      drawingManagerRef.current.redo();
      saveDrawings();
      setNeedsRedraw(true);
    }
  };

  const handleClearAll = () => {
    if (window.confirm('¿Eliminar todos los dibujos?')) {
      if (drawingManagerRef.current) {
        drawingManagerRef.current.clearAll();
        saveDrawings();
        setNeedsRedraw(true);
      }
    }
  };

  return (
    <div className="chart-modal-overlay">
      <div className="chart-modal-container">
        <div className="chart-modal-header">
          <h2>{symbol} - {interval}m</h2>
          <button onClick={onClose} className="close-btn" title="Cerrar (Esc)">
            ✕
          </button>
        </div>

        <DrawingToolbar
          selectedTool={selectedTool}
          onToolChange={handleToolChange}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onClearAll={handleClearAll}
        />

        <div className="chart-canvas-container">
          {loading ? (
            <div className="loading">Cargando datos...</div>
          ) : (
            <canvas
              ref={canvasRef}
              width={window.innerWidth}
              height={window.innerHeight - 100}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ChartModal;
