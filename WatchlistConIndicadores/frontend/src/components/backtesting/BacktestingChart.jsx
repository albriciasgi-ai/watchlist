import React, { useEffect, useRef, useState } from 'react';
// import * as fabric from 'fabric'; // TEMPORALMENTE DESHABILITADO - Fabric.js tiene issues con Vite

const BacktestingChart = ({ symbol, timeframe, marketData, currentTime, timeController }) => {
  const chartCanvasRef = useRef(null);
  const drawingCanvasRef = useRef(null);
  const containerRef = useRef(null);

  const [fabricCanvas, setFabricCanvas] = useState(null);
  const [drawingTool, setDrawingTool] = useState('none'); // 'none', 'line', 'rect', 'text'
  const [visibleCandles, setVisibleCandles] = useState([]);
  const [chartDimensions, setChartDimensions] = useState({ width: 0, height: 0 });

  // Estado de zoom y pan
  const [scale, setScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);

  /**
   * Inicialización del Fabric.js canvas
   * TEMPORALMENTE DESHABILITADO - Fabric.js tiene issues con Vite
   */
  useEffect(() => {
    // TODO: Re-habilitar cuando se solucione el problema de Fabric.js con Vite
    console.log('[BacktestingChart] Drawing tools disabled - Fabric.js compatibility issue');
  }, []);

  /**
   * Ajustar tamaño del canvas al contenedor
   */
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current && chartCanvasRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;

        // Actualizar canvas de chart
        chartCanvasRef.current.width = width;
        chartCanvasRef.current.height = height;

        setChartDimensions({ width, height });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);

    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  /**
   * Actualizar velas visibles según currentTime
   */
  useEffect(() => {
    if (!marketData || !currentTime) return;

    const timeframeData = marketData.timeframes[timeframe];
    if (!timeframeData) return;

    // Filtrar velas hasta currentTime
    const candles = timeframeData.main.filter(candle => candle.timestamp <= currentTime);

    // Obtener subdivisiones de la última vela en progreso
    const lastCandleTime = candles.length > 0 ? candles[candles.length - 1].timestamp : 0;
    const nextCandleTime = lastCandleTime + (timeframeData.subdivision_count * 60 * 1000);

    // Si currentTime está entre lastCandleTime y nextCandleTime, mostrar subdivisiones
    if (currentTime > lastCandleTime && currentTime < nextCandleTime) {
      const subdivisions = timeframeData.subdivisions.filter(
        sub => sub.timestamp > lastCandleTime && sub.timestamp <= currentTime
      );

      setVisibleCandles({
        main: candles,
        currentSubdivisions: subdivisions,
        isFormingNewCandle: true
      });
    } else {
      setVisibleCandles({
        main: candles,
        currentSubdivisions: [],
        isFormingNewCandle: false
      });
    }
  }, [currentTime, marketData, timeframe]);

  /**
   * Renderizar velas en el canvas
   */
  useEffect(() => {
    if (!chartCanvasRef.current || !visibleCandles.main || chartDimensions.width === 0) return;

    const canvas = chartCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const { width, height } = chartDimensions;

    // Limpiar canvas
    ctx.clearRect(0, 0, width, height);

    // Dibujar fondo claro
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Calcular dimensiones del área de chart
    const margin = { top: 20, right: 80, bottom: 40, left: 10 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    if (visibleCandles.main.length === 0) {
      // Mostrar mensaje si no hay datos
      ctx.fillStyle = '#666';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No hay datos para mostrar', width / 2, height / 2);
      return;
    }

    // Calcular escala de precios
    const allPrices = [];
    visibleCandles.main.forEach(c => {
      allPrices.push(c.high, c.low);
    });
    const maxPrice = Math.max(...allPrices);
    const minPrice = Math.min(...allPrices);
    const priceRange = maxPrice - minPrice;
    const priceScale = chartHeight / priceRange;

    // Función para convertir precio a coordenada Y
    const priceToY = (price) => {
      return margin.top + (maxPrice - price) * priceScale;
    };

    // Calcular ancho de vela
    const candleWidth = Math.max(2, chartWidth / visibleCandles.main.length);
    const wickWidth = Math.max(1, candleWidth / 5);

    // Dibujar velas principales
    visibleCandles.main.forEach((candle, index) => {
      const x = margin.left + index * candleWidth + offsetX;
      const yHigh = priceToY(candle.high);
      const yLow = priceToY(candle.low);
      const yOpen = priceToY(candle.open);
      const yClose = priceToY(candle.close);

      const isBullish = candle.close >= candle.open;
      const color = isBullish ? '#26a69a' : '#ef5350';

      // Dibujar mecha
      ctx.strokeStyle = color;
      ctx.lineWidth = wickWidth;
      ctx.beginPath();
      ctx.moveTo(x + candleWidth / 2, yHigh);
      ctx.lineTo(x + candleWidth / 2, yLow);
      ctx.stroke();

      // Dibujar cuerpo
      const bodyHeight = Math.abs(yClose - yOpen);
      const bodyY = Math.min(yOpen, yClose);

      if (bodyHeight < 1) {
        // Doji - línea horizontal
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, yClose);
        ctx.lineTo(x + candleWidth, yClose);
        ctx.stroke();
      } else {
        // Vela normal
        ctx.fillStyle = color;
        ctx.fillRect(x, bodyY, candleWidth - 1, bodyHeight);
      }
    });

    // Dibujar subdivisiones de la vela en formación (si existen)
    if (visibleCandles.isFormingNewCandle && visibleCandles.currentSubdivisions.length > 0) {
      const startX = margin.left + visibleCandles.main.length * candleWidth + offsetX;
      const subCandleWidth = candleWidth / visibleCandles.currentSubdivisions.length;

      visibleCandles.currentSubdivisions.forEach((sub, index) => {
        const x = startX + index * subCandleWidth;
        const yHigh = priceToY(sub.high);
        const yLow = priceToY(sub.low);
        const yOpen = priceToY(sub.open);
        const yClose = priceToY(sub.close);

        const isBullish = sub.close >= sub.open;
        const color = isBullish ? '#26a69a80' : '#ef535080'; // Semi-transparente

        // Dibujar mecha
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, wickWidth / 2);
        ctx.beginPath();
        ctx.moveTo(x + subCandleWidth / 2, yHigh);
        ctx.lineTo(x + subCandleWidth / 2, yLow);
        ctx.stroke();

        // Dibujar cuerpo
        const bodyHeight = Math.abs(yClose - yOpen);
        const bodyY = Math.min(yOpen, yClose);

        if (bodyHeight >= 1) {
          ctx.fillStyle = color;
          ctx.fillRect(x, bodyY, subCandleWidth - 1, bodyHeight);
        }
      });
    }

    // Dibujar escala de precios (derecha)
    ctx.fillStyle = '#666';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';

    const priceSteps = 8;
    for (let i = 0; i <= priceSteps; i++) {
      const price = minPrice + (priceRange / priceSteps) * i;
      const y = priceToY(price);

      // Línea de guía (gris claro)
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(width - margin.right, y);
      ctx.stroke();

      // Etiqueta de precio
      ctx.fillText(price.toFixed(2), width - margin.right + 5, y + 4);
    }

    // Dibujar línea de precio actual
    if (visibleCandles.main.length > 0) {
      const lastCandle = visibleCandles.main[visibleCandles.main.length - 1];
      const currentPriceY = priceToY(lastCandle.close);

      ctx.strokeStyle = '#ffa726';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(margin.left, currentPriceY);
      ctx.lineTo(width - margin.right, currentPriceY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Etiqueta de precio actual
      ctx.fillStyle = '#ffa726';
      ctx.fillRect(width - margin.right, currentPriceY - 10, margin.right - 5, 20);
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center';
      ctx.fillText(
        lastCandle.close.toFixed(2),
        width - margin.right / 2,
        currentPriceY + 4
      );
    }

  }, [visibleCandles, chartDimensions, offsetX, scale]);

  /**
   * Herramientas de dibujo con Fabric.js
   */
  const handleDrawingToolChange = (tool) => {
    setDrawingTool(tool);

    if (!fabricCanvas) return;

    // Resetear modo de dibujo
    fabricCanvas.isDrawingMode = false;
    fabricCanvas.selection = tool === 'none';

    console.log(`[BacktestingChart] Herramienta de dibujo: ${tool}`);
  };

  /**
   * Agregar línea
   */
  const addLine = () => {
    if (!fabricCanvas) return;

    const line = new fabric.Line([50, 100, 200, 100], {
      stroke: '#ff6b6b',
      strokeWidth: 2,
      selectable: true,
      evented: true
    });

    fabricCanvas.add(line);
    fabricCanvas.setActiveObject(line);
    fabricCanvas.renderAll();

    saveDrawingsToLocalStorage();
  };

  /**
   * Agregar rectángulo (caja de TP/SL)
   */
  const addRectangle = () => {
    if (!fabricCanvas) return;

    const rect = new fabric.Rect({
      left: 100,
      top: 100,
      fill: 'rgba(76, 175, 80, 0.2)',
      stroke: '#4caf50',
      strokeWidth: 2,
      width: 150,
      height: 80,
      selectable: true,
      evented: true
    });

    fabricCanvas.add(rect);
    fabricCanvas.setActiveObject(rect);
    fabricCanvas.renderAll();

    saveDrawingsToLocalStorage();
  };

  /**
   * Agregar texto
   */
  const addText = () => {
    if (!fabricCanvas) return;

    const text = new fabric.IText('Texto', {
      left: 100,
      top: 100,
      fontSize: 16,
      fill: '#fff',
      fontFamily: 'monospace',
      selectable: true,
      evented: true
    });

    fabricCanvas.add(text);
    fabricCanvas.setActiveObject(text);
    fabricCanvas.renderAll();

    saveDrawingsToLocalStorage();
  };

  /**
   * Borrar todos los dibujos
   */
  const clearAllDrawings = () => {
    if (!fabricCanvas) return;

    if (confirm('¿Seguro que quieres borrar todos los dibujos?')) {
      fabricCanvas.clear();
      fabricCanvas.renderAll();
      saveDrawingsToLocalStorage();
    }
  };

  /**
   * Guardar dibujos en localStorage
   */
  const saveDrawingsToLocalStorage = () => {
    if (!fabricCanvas) return;

    const json = JSON.stringify(fabricCanvas.toJSON());
    localStorage.setItem(`backtesting_drawings_${symbol}_${timeframe}`, json);

    console.log('[BacktestingChart] Dibujos guardados en localStorage');
  };

  /**
   * Cargar dibujos desde localStorage
   */
  const loadDrawingsFromLocalStorage = () => {
    if (!fabricCanvas) return;

    const savedData = localStorage.getItem(`backtesting_drawings_${symbol}_${timeframe}`);

    if (savedData) {
      fabricCanvas.loadFromJSON(savedData, () => {
        fabricCanvas.renderAll();
        console.log('[BacktestingChart] Dibujos cargados desde localStorage');
      });
    }
  };

  /**
   * Cargar dibujos al montar
   */
  useEffect(() => {
    if (fabricCanvas && symbol && timeframe) {
      loadDrawingsFromLocalStorage();
    }
  }, [fabricCanvas, symbol, timeframe]);

  /**
   * Guardar dibujos automáticamente cuando cambian
   */
  useEffect(() => {
    if (!fabricCanvas) return;

    const handleObjectModified = () => {
      saveDrawingsToLocalStorage();
    };

    fabricCanvas.on('object:modified', handleObjectModified);
    fabricCanvas.on('object:added', handleObjectModified);
    fabricCanvas.on('object:removed', handleObjectModified);

    return () => {
      fabricCanvas.off('object:modified', handleObjectModified);
      fabricCanvas.off('object:added', handleObjectModified);
      fabricCanvas.off('object:removed', handleObjectModified);
    };
  }, [fabricCanvas, symbol, timeframe]);

  return (
    <div className="backtesting-chart-container">
      {/* DRAWING TOOLBAR TEMPORALMENTE DESHABILITADO
      <div className="drawing-toolbar">
        <button
          className={drawingTool === 'none' ? 'active' : ''}
          onClick={() => handleDrawingToolChange('none')}
          title="Seleccionar"
        >
          ↖️ Seleccionar
        </button>

        <button onClick={addLine} title="Línea">
          📏 Línea
        </button>

        <button onClick={addRectangle} title="Rectángulo (TP/SL)">
          ⬜ Rectángulo
        </button>

        <button onClick={addText} title="Texto">
          📝 Texto
        </button>

        <div className="toolbar-divider"></div>

        <button onClick={clearAllDrawings} className="btn-danger" title="Borrar todo">
          🗑️ Borrar Todo
        </button>
      </div>
      */}

      <div className="chart-wrapper" ref={containerRef}>
        <canvas ref={chartCanvasRef} className="chart-canvas"></canvas>
        {/* <canvas ref={drawingCanvasRef} className="drawing-canvas"></canvas> */}
      </div>
    </div>
  );
};

export default BacktestingChart;
