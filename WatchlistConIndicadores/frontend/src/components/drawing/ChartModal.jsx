// src/components/drawing/ChartModal.jsx
// Modal fullscreen para análisis de gráficos con herramientas de dibujo

import React, { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE_URL } from "../../config";
import DrawingToolManager from "./DrawingToolManager";
import DrawingToolbar from "./DrawingToolbar";
import MeasurementTool from "./MeasurementTool";
import MeasurementShape from "./shapes/MeasurementShape";
import TextEditModal from "./TextEditModal";
import ColorPickerModal from "./ColorPickerModal";
import "./ChartModal.css";

const ChartModal = ({ symbol, interval, days, indicatorManagerRef, indicatorStates, onClose }) => {
  const canvasRef = useRef(null);
  const drawingManagerRef = useRef(null);
  const measurementToolRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastMeasurementClickTimeRef = useRef(0);
  const lastTextBoxClickTimeRef = useRef(0);
  const lastTextBoxClickedIdRef = useRef(null);
  const redrawPendingRef = useRef(false);
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTool, setSelectedTool] = useState('select');
  const [needsRedraw, setNeedsRedraw] = useState(false);

  // Estados para modales
  const [isTextEditModalOpen, setIsTextEditModalOpen] = useState(false);
  const [textBoxBeingEdited, setTextBoxBeingEdited] = useState(null);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [shapeBeingColored, setShapeBeingColored] = useState(null);

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
    drawingManagerRef.current = new DrawingToolManager(symbol, interval, setSelectedTool);
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
      const result = await response.json();
      // El API devuelve { data: [...], success: true, ... }
      setCandles(result.data || []);
      setLoading(false);
    } catch (error) {
      console.error('Error loading historical data:', error);
      setCandles([]);
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

  // Helper to request redraw with throttling
  const requestRedraw = useCallback(() => {
    if (!redrawPendingRef.current) {
      redrawPendingRef.current = true;
      setNeedsRedraw(true);
    }
  }, []);

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
      e.stopPropagation();

      // Limpiar TODOS los estados de drag/resize antes de iniciar measurement
      dragStateRef.current.isDragging = false;

      if (drawingManagerRef.current && drawingManagerRef.current.selectedShape) {
        const shape = drawingManagerRef.current.selectedShape;
        if (shape.isDragging || shape.isResizing) {
          shape.endDrag();
        }
      }

      measurementToolRef.current.handleMouseDown(e, canvas);
      // Renderizar inmediatamente para mostrar el punto inicial
      setNeedsRedraw(true);
      return;
    }

    // Detectar doble click sobre measurement para hacerlo permanente
    if (e.button === 0 && measurementToolRef.current) {
      const measurement = measurementToolRef.current;

      // Si hay una medición finalizada (no está midiendo pero tiene puntos)
      if (!measurement.isMeasuring && measurement.startPoint && measurement.endPoint) {
        const now = Date.now();
        const timeSinceLastClick = now - lastMeasurementClickTimeRef.current;
        lastMeasurementClickTimeRef.current = now;

        // Doble click detectado (menos de 300ms)
        if (timeSinceLastClick < 300) {
          e.preventDefault();
          e.stopPropagation();

          const scaleConverter = calculateScaleConverter();
          if (scaleConverter && drawingManagerRef.current) {
            // Convertir medición a MeasurementShape permanente
            const price1 = scaleConverter.yToPrice(measurement.startPoint.y);
            const price2 = scaleConverter.yToPrice(measurement.endPoint.y);
            const time1 = scaleConverter.xToTime(measurement.startPoint.x);
            const time2 = scaleConverter.xToTime(measurement.endPoint.x);

            if (time1 && time2) {
              const measurementShape = new MeasurementShape(price1, time1, price2, time2);
              drawingManagerRef.current.addShape(measurementShape);
              drawingManagerRef.current.saveToHistory();

              // Guardar en servidor
              saveDrawings();

              // Limpiar measurement tool
              measurement.clear();

              // Re-renderizar
              setNeedsRedraw(true);

              console.log('✅ Medición guardada permanentemente');
              return;
            }
          }
        }
      }
    }

    // Drawing tools
    if (e.button === 0 && drawingManagerRef.current) {
      const scaleConverter = calculateScaleConverter();

      // ✅ NUEVO: Doble click en TextBox para editar (usando modal React)
      const clickedShape = drawingManagerRef.current.findShapeAt(x, y, scaleConverter);

      if (clickedShape && clickedShape.type === 'textbox') {
        const now = Date.now();
        const timeSinceLastClick = now - lastTextBoxClickTimeRef.current;
        const isSameTextBox = lastTextBoxClickedIdRef.current === clickedShape.id;

        if (timeSinceLastClick < 300 && isSameTextBox) {
          e.preventDefault();
          e.stopPropagation();

          // Abrir modal de edición de texto (React, no bloqueante)
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
        x, y, scaleConverter, selectedTool
      );

      if (consumed) {
        // Si se creó un TextBox nuevo, abrir modal inmediatamente
        if (selectedTool === 'textbox') {
          const shapes = drawingManagerRef.current.shapes;
          const newTextBox = shapes[shapes.length - 1]; // El último shape agregado
          if (newTextBox && newTextBox.type === 'textbox') {
            setTextBoxBeingEdited(newTextBox);
            setIsTextEditModalOpen(true);
          }
        }

        // Un shape fue seleccionado o estamos dibujando - renderizar inmediatamente
        setNeedsRedraw(true);
        return;
      }

      // Pan mode SOLO si no se consumió el click (no hay shape seleccionado)
      // Y SOLO si estamos en modo select
      if (selectedTool === 'select' && !consumed) {
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
      // Renderizar con throttling para evitar exceso de redraws
      requestRedraw();
      return;
    }

    // Drawing tools
    if (drawingManagerRef.current) {
      const scaleConverter = calculateScaleConverter();
      const consumed = drawingManagerRef.current.handleMouseMove(x, y, scaleConverter);

      // Cambiar cursor basado en el estado
      if (selectedTool === 'select') {
        const selectedShape = drawingManagerRef.current.selectedShape;
        if (selectedShape && (selectedShape.isDragging || selectedShape.isResizing)) {
          canvas.style.cursor = 'grabbing';
        } else if (drawingManagerRef.current.hoveredShape) {
          canvas.style.cursor = 'grab';
        } else {
          canvas.style.cursor = 'default';
        }
      } else {
        canvas.style.cursor = 'crosshair';
      }

      if (consumed) {
        // Renderizar con throttling para evitar exceso de redraws
        requestRedraw();
        return;
      }
    }

    // Pan mode - SOLO si no estamos arrastrando un shape
    const isShapeDragging = drawingManagerRef.current?.selectedShape?.isDragging ||
                            drawingManagerRef.current?.selectedShape?.isResizing;

    if (dragStateRef.current.isDragging && !isShapeDragging) {
      const deltaX = x - dragStateRef.current.startX;
      const chartWidth = canvas.width - 75; // margins
      const candlesPerScreen = Math.floor(chartWidth / (8 * viewStateRef.current.zoom));
      const pixelsPerCandle = chartWidth / candlesPerScreen;
      const candleDelta = Math.floor(deltaX / pixelsPerCandle);

      viewStateRef.current.offset = Math.max(0, dragStateRef.current.startOffset - candleDelta);

      // Vertical pan
      const deltaY = y - dragStateRef.current.startY;
      viewStateRef.current.verticalOffset = dragStateRef.current.startVerticalOffset + deltaY;

      // Renderizar con throttling para evitar exceso de redraws
      requestRedraw();
    }
  }, [selectedTool, requestRedraw]);

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
    e.stopPropagation();

    // No hacer zoom si estamos en medio de una medición
    if (measurementToolRef.current && measurementToolRef.current.isMeasuring) {
      return;
    }

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

    // Usar setNeedsRedraw en lugar de llamar drawChart directamente
    setNeedsRedraw(true);
  }, []);

  const handleKeyDown = useCallback((e) => {
    // Ctrl+Shift+Esc - Limpieza forzada de TODOS los estados (modo pánico)
    if (e.key === 'Escape' && e.ctrlKey && e.shiftKey) {
      console.log('[DEBUG] ⚠️ LIMPIEZA FORZADA DE ESTADOS - Modo pánico activado');

      // Forzar limpieza de TODO sin preguntar
      if (measurementToolRef.current) {
        measurementToolRef.current.clear();
      }

      if (drawingManagerRef.current) {
        drawingManagerRef.current.cancelDrawing();
        if (drawingManagerRef.current.selectedShape) {
          drawingManagerRef.current.selectedShape.endDrag();
          drawingManagerRef.current.selectedShape = null;
        }
      }

      dragStateRef.current.isDragging = false;

      console.log('[DEBUG] ✅ Todos los estados limpiados');
      setNeedsRedraw(true);
      return;
    }

    // Esc - Cancelar/Cerrar
    if (e.key === 'Escape') {
      let somethingWasCancelled = false;

      // Limpiar medición si existe
      if (measurementToolRef.current && (measurementToolRef.current.isMeasuring || measurementToolRef.current.startPoint)) {
        measurementToolRef.current.clear();
        somethingWasCancelled = true;
      }

      // Limpiar dibujo en progreso
      if (drawingManagerRef.current && drawingManagerRef.current.isDrawing()) {
        drawingManagerRef.current.cancelDrawing();
        somethingWasCancelled = true;
      }

      // Limpiar shape seleccionado y estados de drag
      if (drawingManagerRef.current && drawingManagerRef.current.selectedShape) {
        const shape = drawingManagerRef.current.selectedShape;
        if (shape.isDragging || shape.isResizing) {
          shape.endDrag();
          somethingWasCancelled = true;
        }
        drawingManagerRef.current.selectedShape = null;
        somethingWasCancelled = true;
      }

      // Limpiar estado de pan/drag
      if (dragStateRef.current.isDragging) {
        dragStateRef.current.isDragging = false;
        somethingWasCancelled = true;
      }

      if (somethingWasCancelled) {
        setNeedsRedraw(true);
        return;
      }

      // Si no había nada que cancelar, cerrar el modal
      onClose();
    }

    // Shortcuts de herramientas
    if (e.key === 't' || e.key === 'T') {
      setSelectedTool('trendline');
      if (drawingManagerRef.current) drawingManagerRef.current.setTool('trendline');
    }
    if (e.key === 'h' || e.key === 'H') {
      setSelectedTool('horizontal');
      if (drawingManagerRef.current) drawingManagerRef.current.setTool('horizontal');
    }
    if (e.key === 'l' || e.key === 'L') {
      setSelectedTool('vertical');
      if (drawingManagerRef.current) drawingManagerRef.current.setTool('vertical');
    }
    if (e.key === 'r' || e.key === 'R') {
      setSelectedTool('rectangle');
      if (drawingManagerRef.current) drawingManagerRef.current.setTool('rectangle');
    }
    if (e.key === 'f' || e.key === 'F') {
      setSelectedTool('fibonacci');
      if (drawingManagerRef.current) drawingManagerRef.current.setTool('fibonacci');
    }
    if (e.key === 'p' || e.key === 'P') {
      setSelectedTool('tpsl');
      if (drawingManagerRef.current) drawingManagerRef.current.setTool('tpsl');
    }
    if (e.key === 'n' || e.key === 'N') {
      setSelectedTool('textbox');
      if (drawingManagerRef.current) drawingManagerRef.current.setTool('textbox');
    }
    if (e.key === 'v' || e.key === 'V') {
      setSelectedTool('select');
      if (drawingManagerRef.current) drawingManagerRef.current.setTool('select');
    }

    // C - Cambiar color de línea seleccionada
    if (e.key === 'c' || e.key === 'C') {
      if (drawingManagerRef.current && drawingManagerRef.current.selectedShape) {
        const shape = drawingManagerRef.current.selectedShape;
        // Solo para líneas que tienen color editable
        if (['trendline', 'horizontal', 'vertical'].includes(shape.type)) {
          setShapeBeingColored(shape);
          setIsColorPickerOpen(true);
        }
      }
    }

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

    // Listener global de mouseup para capturar cuando sueltan fuera del canvas
    document.addEventListener('mouseup', handleMouseUp);

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
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseDown, handleMouseMove, handleMouseUp, handleWheel, handleKeyDown]);

  // Función helper para calcular conversión de escalas
  const calculateScaleConverter = () => {
    const canvas = canvasRef.current;
    if (!canvas || !Array.isArray(candles) || candles.length === 0) return null;

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

    // Validar que haya velas visibles
    if (visibleCandles.length === 0) {
      console.warn('No visible candles, using all candles for price range');
      const minPrice = Math.min(...candles.map(c => c.low));
      const maxPrice = Math.max(...candles.map(c => c.high));
      const priceRange = maxPrice - minPrice;
      // Return early with all candles as visible
      return {
        canvas,
        candles,
        visibleCandles: candles,
        startIdx: 0,
        endIdx: candles.length,
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
        priceToY: (price) => {
          const baseYScale = priceRange > 0 ? chartHeight / priceRange : 1;
          const yScale = baseYScale * viewStateRef.current.verticalZoom;
          return marginTop + chartHeight - (price - minPrice) * yScale + viewStateRef.current.verticalOffset;
        },
        yToPrice: (y) => {
          const baseYScale = priceRange > 0 ? chartHeight / priceRange : 1;
          const yScale = baseYScale * viewStateRef.current.verticalZoom;
          const relativeY = y - marginTop - viewStateRef.current.verticalOffset;
          return minPrice + (chartHeight - relativeY) / yScale;
        },
        timeToX: (timestamp) => {
          const candleIndex = candles.findIndex(c => c.timestamp === timestamp);
          if (candleIndex === -1) return null;
          const barWidth = chartWidth / candles.length;
          return marginLeft + (candleIndex * barWidth) + (barWidth / 2);
        },
        xToTime: (x) => {
          const relativeX = x - marginLeft;
          const barWidth = chartWidth / candles.length;
          const fractionalIndex = (relativeX - barWidth / 2) / barWidth;
          const nearestIndex = Math.round(fractionalIndex);
          return candles[nearestIndex]?.timestamp || null;
        }
      };
    }

    // Calcular min/max de velas visibles
    const minPrice = Math.min(...visibleCandles.map(c => c.low));
    const maxPrice = Math.max(...visibleCandles.map(c => c.high));
    const priceRange = maxPrice - minPrice;

    return {
      canvas,
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
        return minPrice + (chartHeight - relativeY) / yScale;
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

        // Snap to nearest candle center instead of flooring to containing candle
        // This prevents offset when drawing trendlines
        const fractionalIndex = (relativeX - barWidth / 2) / barWidth;
        const nearestIndex = Math.round(fractionalIndex);
        const candleIndex = startIdx + nearestIndex;

        return candles[candleIndex]?.timestamp || null;
      }
    };
  };

  // Renderizado del chart
  useEffect(() => {
    if (needsRedraw || candles.length > 0) {
      // Usar requestAnimationFrame para asegurar que el render ocurra
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      animationFrameRef.current = requestAnimationFrame(() => {
        drawChart();
        setNeedsRedraw(false);
        redrawPendingRef.current = false;
        animationFrameRef.current = null;
      });
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
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

    // Renderizar indicadores (si están disponibles)
    if (indicatorManagerRef && indicatorManagerRef.current) {
      const overlayBounds = {
        x: marginLeft,
        y: marginTop,
        width: chartWidth,
        height: chartHeight
      };
      const priceContext = {
        minPrice: scaleConverter.minPrice,
        maxPrice: scaleConverter.maxPrice,
        priceRange: scaleConverter.priceRange,
        verticalZoom: scaleConverter.verticalZoom,
        verticalOffset: scaleConverter.verticalOffset,
        yScale: scaleConverter.priceRange > 0 ? chartHeight / scaleConverter.priceRange : 1
      };
      indicatorManagerRef.current.renderOverlays(ctx, overlayBounds, visibleCandles, candles, priceContext);
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

  // Handlers para TextEditModal
  const handleTextSave = (newText) => {
    if (textBoxBeingEdited && newText.trim()) {
      textBoxBeingEdited.setText(newText);
      drawingManagerRef.current.saveToHistory();
      saveDrawings();
      setNeedsRedraw(true);

      // IMPORTANTE: Cambiar automáticamente a modo select después de guardar
      setSelectedTool('select');
      if (drawingManagerRef.current) drawingManagerRef.current.setTool('select');
    } else if (textBoxBeingEdited && !newText.trim()) {
      // Si el texto está vacío, eliminar el TextBox
      const index = drawingManagerRef.current.shapes.indexOf(textBoxBeingEdited);
      if (index !== -1) {
        drawingManagerRef.current.shapes.splice(index, 1);
        drawingManagerRef.current.saveToHistory();
        saveDrawings();
        setNeedsRedraw(true);
      }

      // Cambiar a modo select
      setSelectedTool('select');
      if (drawingManagerRef.current) drawingManagerRef.current.setTool('select');
    }
    setIsTextEditModalOpen(false);
    setTextBoxBeingEdited(null);
  };

  const handleTextCancel = () => {
    // Si era un TextBox nuevo (sin texto o con texto por defecto), eliminarlo
    if (textBoxBeingEdited &&
        (textBoxBeingEdited.text === 'Escribe aquí...' || textBoxBeingEdited.text === 'Texto...')) {
      const index = drawingManagerRef.current.shapes.indexOf(textBoxBeingEdited);
      if (index !== -1) {
        drawingManagerRef.current.shapes.splice(index, 1);
        setNeedsRedraw(true);
      }
    }

    // IMPORTANTE: Cambiar a modo select al cancelar
    setSelectedTool('select');
    if (drawingManagerRef.current) drawingManagerRef.current.setTool('select');

    setIsTextEditModalOpen(false);
    setTextBoxBeingEdited(null);
  };

  // Handlers para ColorPickerModal
  const handleColorSave = (newColor) => {
    if (shapeBeingColored && shapeBeingColored.style) {
      shapeBeingColored.style.color = newColor;
      drawingManagerRef.current.saveToHistory();
      saveDrawings();
      setNeedsRedraw(true);
    }
    setIsColorPickerOpen(false);
    setShapeBeingColored(null);
  };

  const handleColorCancel = () => {
    setIsColorPickerOpen(false);
    setShapeBeingColored(null);
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

      {/* Modales */}
      {isTextEditModalOpen && textBoxBeingEdited && (
        <TextEditModal
          initialText={textBoxBeingEdited.text}
          onSave={handleTextSave}
          onCancel={handleTextCancel}
        />
      )}

      {isColorPickerOpen && shapeBeingColored && (
        <ColorPickerModal
          currentColor={shapeBeingColored.style.color}
          shapeName={
            shapeBeingColored.type === 'trendline' ? 'Línea de Tendencia' :
            shapeBeingColored.type === 'horizontal' ? 'Línea Horizontal' :
            shapeBeingColored.type === 'vertical' ? 'Línea Vertical' : 'Línea'
          }
          onSave={handleColorSave}
          onCancel={handleColorCancel}
        />
      )}
    </div>
  );
};

export default ChartModal;
