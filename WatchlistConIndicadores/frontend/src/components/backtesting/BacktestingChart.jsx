import React, { useEffect, useRef, useState } from 'react';
// import * as fabric from 'fabric'; // TEMPORALMENTE DESHABILITADO - Fabric.js tiene issues con Vite

const BacktestingChart = ({ symbol, timeframe, marketData, currentTime, isPlaying, timeController, orderManager }) => {
  const chartCanvasRef = useRef(null);
  const drawingCanvasRef = useRef(null);
  const containerRef = useRef(null);

  const [fabricCanvas, setFabricCanvas] = useState(null);
  const [drawingTool, setDrawingTool] = useState('none'); // 'none', 'line', 'rect', 'text'
  const [visibleCandles, setVisibleCandles] = useState([]);
  const [chartDimensions, setChartDimensions] = useState({ width: 0, height: 0 });
  const [orders, setOrders] = useState([]);

  // Estado de zoom y pan
  const [scaleX, setScaleX] = useState(1); // Zoom horizontal
  const [scaleY, setScaleY] = useState(1); // Zoom vertical (precio)
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [manualPan, setManualPan] = useState(false); // Usuario movió manualmente

  // Configuración de visualización
  const CANDLE_WIDTH = 8; // Ancho fijo por vela
  const CANDLE_SPACING = 2; // Espacio entre velas

  // CRÍTICO: Mostrar contexto histórico completo antes de currentTime
  // Esto permite que el usuario vea todo el historial de 3 años
  // - TimeController.startTime = inicio del historial completo
  // - TimeController.simulationStartTime = donde empieza la simulación
  // - TimeController.currentTime = posición actual (inicia en simulationStartTime)
  // - El chart muestra TODAS las velas antes de currentTime para contexto completo
  const VISIBLE_HISTORY = Infinity; // Mostrar TODAS las velas históricas para contexto completo

  /**
   * Ir a la última vela - resetea el paneo manual y reactiva auto-scroll
   */
  const goToLastCandle = () => {
    setManualPan(false); // Reactivar auto-scroll
    setScaleX(1); // Resetear zoom horizontal
    setScaleY(1); // Resetear zoom vertical
    console.log('[BacktestingChart] Navegando a última vela');
  };

  /**
   * Actualizar órdenes cuando cambia el orderManager
   */
  useEffect(() => {
    if (!orderManager) return;

    const updateOrders = () => {
      setOrders(orderManager.getAllOrders());
    };

    updateOrders();
    const interval = setInterval(updateOrders, 1000);

    return () => clearInterval(interval);
  }, [orderManager]);

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
   * IMPORTANTE: Muestra TODO el historial desde el inicio hasta currentTime
   * - VISIBLE_HISTORY = Infinity garantiza que se muestren TODAS las velas históricas
   * - currentTime inicia en simulationStartTime (la fecha donde empieza la simulación)
   * - Al dar play, currentTime avanza desde simulationStartTime hacia adelante
   * - TODAS las velas anteriores a simulationStartTime permanecen visibles para contexto
   * - Esto permite ver el historial completo sin importar donde empiece la simulación
   */
  useEffect(() => {
    if (!marketData) return;

    const timeframeData = marketData.timeframes[timeframe];
    if (!timeframeData) return;

    // Si no hay currentTime, mostrar todas las velas disponibles
    if (!currentTime) {
      setVisibleCandles({
        main: timeframeData.main,
        currentSubdivisions: [],
        isFormingNewCandle: false,
        currentTimeMarker: null
      });
      return;
    }

    // Encontrar el índice de la última vela que no excede currentTime
    const currentIndex = timeframeData.main.findIndex(candle => candle.timestamp > currentTime);
    const lastVisibleIndex = currentIndex === -1 ? timeframeData.main.length : currentIndex;

    // Calcular índice de inicio (incluir historial previo)
    // Con VISIBLE_HISTORY = Infinity, startIndex siempre será 0, mostrando TODO el historial
    const startIndex = Math.max(0, lastVisibleIndex - VISIBLE_HISTORY);

    // Obtener velas desde el inicio del historial (startIndex = 0) hasta lastVisibleIndex
    // Esto garantiza que se vea todo el contexto histórico antes de la fecha de inicio
    const candles = timeframeData.main.slice(startIndex, lastVisibleIndex);

    // DEBUG: Mostrar información sobre las velas visibles
    console.log('[BacktestingChart] Velas visibles:');
    console.log(`  - Total de velas en datos: ${timeframeData.main.length}`);
    console.log(`  - currentTime: ${new Date(currentTime).toISOString()}`);
    console.log(`  - lastVisibleIndex: ${lastVisibleIndex}`);
    console.log(`  - startIndex: ${startIndex}`);
    console.log(`  - Velas a mostrar: ${candles.length}`);
    if (candles.length > 0) {
      console.log(`  - Primera vela: ${new Date(candles[0].timestamp).toISOString()}`);
      console.log(`  - Última vela: ${new Date(candles[candles.length - 1].timestamp).toISOString()}`);
    }

    // Obtener subdivisiones de la última vela en progreso
    const lastCandleTime = candles.length > 0 ? candles[candles.length - 1].timestamp : 0;

    // Calcular duración del timeframe en ms
    const timeframeMinutes = {
      "15m": 15,
      "1h": 60,
      "4h": 240
    };
    const timeframeDuration = (timeframeMinutes[timeframe] || 15) * 60 * 1000;
    const nextCandleTime = lastCandleTime + timeframeDuration;

    // Si currentTime está entre lastCandleTime y nextCandleTime, mostrar subdivisiones
    if (currentTime > lastCandleTime && currentTime < nextCandleTime) {
      const subdivisions = timeframeData.subdivisions.filter(
        sub => sub.timestamp > lastCandleTime && sub.timestamp <= currentTime
      );

      setVisibleCandles({
        main: candles,
        currentSubdivisions: subdivisions,
        isFormingNewCandle: true,
        currentTimeMarker: currentTime
      });
    } else {
      setVisibleCandles({
        main: candles,
        currentSubdivisions: [],
        isFormingNewCandle: false,
        currentTimeMarker: currentTime
      });
    }

    // Auto-scroll: posicionar el chart adecuadamente
    // Durante la reproducción (isPlaying), siempre hacer auto-scroll
    // Si está pausado, solo hacer auto-scroll si el usuario no ha hecho paneo manual
    const shouldAutoScroll = chartDimensions.width > 0 && candles.length > 0 && (isPlaying || !manualPan);

    if (shouldAutoScroll) {
      const totalCandleWidth = (CANDLE_WIDTH + CANDLE_SPACING) * scaleX;
      const maxVisibleCandles = Math.floor((chartDimensions.width - 100) / totalCandleWidth);

      if (candles.length > maxVisibleCandles) {
        // Calcular cuántas velas hay antes de currentTime
        // Esto nos permite posicionar el chart para mostrar contexto
        const candlesBeforeCurrent = candles.filter(c => c.timestamp < currentTime).length;

        // Si estamos al inicio de la simulación (no reproduciendo), mostrar contexto histórico amplio
        // Mostrar las velas del historial previo + la posición actual
        if (!isPlaying) {
          // Mostrar el 70% del espacio disponible para contexto histórico antes de currentTime
          // Esto permite ver suficiente historia sin perder la posición actual
          const contextCandles = Math.min(candlesBeforeCurrent, Math.floor(maxVisibleCandles * 0.7));
          const startCandle = Math.max(0, candlesBeforeCurrent - contextCandles);
          const newOffsetX = -startCandle * totalCandleWidth;
          setOffsetX(newOffsetX);
          console.log('[BacktestingChart] Posicionando chart con contexto histórico:');
          console.log(`  - maxVisibleCandles: ${maxVisibleCandles}`);
          console.log(`  - candlesBeforeCurrent: ${candlesBeforeCurrent}`);
          console.log(`  - Mostrando desde vela: ${startCandle} (contexto: ${contextCandles} velas)`);
          console.log(`  - currentTime: ${new Date(currentTime).toISOString()}`);
        } else {
          // Durante reproducción, hacer auto-scroll normal para seguir el precio actual
          const rightPadding = Math.floor(maxVisibleCandles * 0.3); // 30% del espacio a la derecha
          const newOffsetX = Math.min(0, -(candles.length - maxVisibleCandles + rightPadding) * totalCandleWidth);
          setOffsetX(newOffsetX);
        }
      } else {
        // Si hay pocas velas, centrarlas
        const centerOffset = (chartDimensions.width - (candles.length * totalCandleWidth)) / 2;
        setOffsetX(Math.max(0, centerOffset));
      }
    }
  }, [currentTime, marketData, timeframe, chartDimensions.width, isPlaying, manualPan, scaleX]);

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

    // Calcular escala de precios con padding (5% arriba y abajo)
    // IMPORTANTE: Usar TODAS las velas disponibles para mantener contexto constante
    // Esto evita que la escala cambie automáticamente durante la simulación
    const allPrices = [];
    visibleCandles.main.forEach(c => {
      allPrices.push(c.high, c.low);
    });

    // Si hay subdivisiones, incluirlas en el cálculo
    if (visibleCandles.currentSubdivisions && visibleCandles.currentSubdivisions.length > 0) {
      visibleCandles.currentSubdivisions.forEach(sub => {
        allPrices.push(sub.high, sub.low);
      });
    }

    if (allPrices.length === 0) {
      // No hay datos
      ctx.fillStyle = '#666';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No hay precios para calcular', width / 2, height / 2);
      return;
    }

    const maxPriceRaw = Math.max(...allPrices);
    const minPriceRaw = Math.min(...allPrices);
    const priceRangeRaw = maxPriceRaw - minPriceRaw;

    // Protección: Si el rango es 0 (todas las velas al mismo precio), usar un rango mínimo
    const effectivePriceRange = priceRangeRaw > 0 ? priceRangeRaw : maxPriceRaw * 0.01;
    const padding = effectivePriceRange * 0.05; // 5% padding

    // Aplicar zoom vertical ajustando el rango de precios visible
    // scaleY > 1 = zoom in = ver menos rango de precios
    // scaleY < 1 = zoom out = ver más rango de precios
    const priceCenter = (maxPriceRaw + minPriceRaw) / 2;
    const zoomedRange = (effectivePriceRange + padding * 2) / scaleY;
    const maxPrice = priceCenter + zoomedRange / 2;
    const minPrice = priceCenter - zoomedRange / 2;
    const priceRange = maxPrice - minPrice;

    // Protección: Evitar división por cero
    const priceScale = priceRange > 0 ? (chartHeight / priceRange) : 1;

    // Función para convertir precio a coordenada Y
    const priceToY = (price) => {
      return margin.top + (maxPrice - price) * priceScale;
    };

    // Usar ancho de vela con zoom aplicado
    const candleWidth = CANDLE_WIDTH * scaleX;
    const wickWidth = Math.max(1, candleWidth / 5);

    // Dibujar velas principales con espaciado con zoom aplicado
    const totalCandleWidth = (CANDLE_WIDTH + CANDLE_SPACING) * scaleX;
    visibleCandles.main.forEach((candle, index) => {
      const x = margin.left + index * totalCandleWidth + offsetX;
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
      const startX = margin.left + visibleCandles.main.length * totalCandleWidth + offsetX;
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

    // Dibujar órdenes (líneas de entrada, SL, TP)
    if (orders && orders.length > 0) {
      orders.forEach(order => {
        // Solo dibujar órdenes que están en el rango de precios visible
        if (order.entryPrice < minPrice || order.entryPrice > maxPrice) return;

        const isOpen = order.status === 'open';
        const isClosed = order.status === 'closed';
        const isLong = order.side === 'long';

        // Línea de entrada
        const entryY = priceToY(order.entryPrice);
        ctx.strokeStyle = isOpen ? (isLong ? '#26a69a' : '#ef5350') : '#999';
        ctx.lineWidth = isOpen ? 2 : 1;
        ctx.setLineDash(isOpen ? [] : [3, 3]);
        ctx.beginPath();
        ctx.moveTo(margin.left, entryY);
        ctx.lineTo(width - margin.right, entryY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Etiqueta de entrada
        ctx.fillStyle = isOpen ? (isLong ? '#26a69a' : '#ef5350') : '#999';
        ctx.fillRect(margin.left, entryY - 8, 30, 16);
        ctx.fillStyle = '#fff';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`#${order.id}`, margin.left + 2, entryY + 3);

        // Dibujar Stop Loss si existe
        if (order.stopLoss && order.stopLoss >= minPrice && order.stopLoss <= maxPrice) {
          const slY = priceToY(order.stopLoss);
          ctx.strokeStyle = '#ef5350';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(margin.left, slY);
          ctx.lineTo(width - margin.right, slY);
          ctx.stroke();
          ctx.setLineDash([]);

          // Etiqueta SL
          ctx.fillStyle = '#ef5350';
          ctx.fillRect(margin.left, slY - 8, 20, 16);
          ctx.fillStyle = '#fff';
          ctx.font = '9px monospace';
          ctx.textAlign = 'left';
          ctx.fillText('SL', margin.left + 2, slY + 3);
        }

        // Dibujar Take Profit si existe
        if (order.takeProfit && order.takeProfit >= minPrice && order.takeProfit <= maxPrice) {
          const tpY = priceToY(order.takeProfit);
          ctx.strokeStyle = '#26a69a';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(margin.left, tpY);
          ctx.lineTo(width - margin.right, tpY);
          ctx.stroke();
          ctx.setLineDash([]);

          // Etiqueta TP
          ctx.fillStyle = '#26a69a';
          ctx.fillRect(margin.left, tpY - 8, 20, 16);
          ctx.fillStyle = '#fff';
          ctx.font = '9px monospace';
          ctx.textAlign = 'left';
          ctx.fillText('TP', margin.left + 2, tpY + 3);
        }

        // Dibujar precio de salida si la orden está cerrada
        if (isClosed && order.exitPrice && order.exitPrice >= minPrice && order.exitPrice <= maxPrice) {
          const exitY = priceToY(order.exitPrice);
          const isProfitable = order.pnl > 0;

          ctx.strokeStyle = isProfitable ? '#26a69a80' : '#ef535080';
          ctx.lineWidth = 1;
          ctx.setLineDash([1, 2]);
          ctx.beginPath();
          ctx.moveTo(margin.left, exitY);
          ctx.lineTo(width - margin.right, exitY);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });
    }

    // Dibujar indicador de fecha/tiempo actual (en la parte superior del gráfico)
    if (visibleCandles.currentTimeMarker) {
      const dateStr = new Date(visibleCandles.currentTimeMarker).toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      // Fondo semi-transparente
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(margin.left + 10, margin.top + 10, 200, 30);

      // Texto de fecha/hora
      ctx.fillStyle = '#ffa726';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(dateStr, margin.left + 18, margin.top + 28);
    }

    // Dibujar rótulos de tiempo en el eje horizontal
    ctx.fillStyle = '#333';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';

    // Calcular cuántas etiquetas mostrar basado en el ancho disponible
    const timeLabelsCount = Math.min(10, Math.floor(chartWidth / 100)); // Una etiqueta cada ~100px
    const candleStep = Math.max(1, Math.floor(visibleCandles.main.length / timeLabelsCount));

    for (let i = 0; i < visibleCandles.main.length; i += candleStep) {
      const candle = visibleCandles.main[i];
      const x = margin.left + i * totalCandleWidth + offsetX + candleWidth / 2;

      // Solo dibujar si está visible en pantalla
      if (x >= margin.left && x <= width - margin.right) {
        const date = new Date(candle.timestamp);

        // Formato más compacto: DD/MM HH:mm
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const timeStr = `${day}/${month} ${hours}:${minutes}`;

        // Rotar texto para que quepa mejor
        ctx.save();
        ctx.translate(x, height - margin.bottom + 18);
        ctx.rotate(-Math.PI / 4); // Rotar 45 grados
        ctx.fillStyle = '#444';
        ctx.fillText(timeStr, 0, 0);
        ctx.restore();

        // Línea de marca más visible
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, height - margin.bottom);
        ctx.lineTo(x, height - margin.bottom + 8);
        ctx.stroke();

        // Línea vertical de guía (opcional, más sutil)
        ctx.strokeStyle = '#f5f5f5';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, height - margin.bottom);
        ctx.stroke();
      }
    }

  }, [visibleCandles, chartDimensions, offsetX, scaleX, scaleY, orders]);

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
   * Event handlers para paneo (drag) y zoom (wheel)
   */
  useEffect(() => {
    const canvas = chartCanvasRef.current;
    if (!canvas) return;

    // Mouse down - iniciar drag
    const handleMouseDown = (e) => {
      setIsDragging(true);
      setDragStart({ x: e.clientX - offsetX, y: e.clientY - offsetY });
    };

    // Mouse move - arrastrar (solo horizontal, no vertical para evitar cambios de escala)
    const handleMouseMove = (e) => {
      if (!isDragging) return;

      let newOffsetX = e.clientX - dragStart.x;

      // Limitar el paneo horizontal para mantener las velas dentro del canvas
      const margin = { top: 20, right: 80, bottom: 40, left: 10 };
      const chartWidth = canvas.width - margin.left - margin.right;
      const totalCandleWidth = (CANDLE_WIDTH + CANDLE_SPACING) * scaleX;
      const totalWidth = visibleCandles.main.length * totalCandleWidth;

      // Límite derecho: no mover más allá del inicio
      const maxOffsetX = 0;
      // Límite izquierdo: mostrar al menos la última vela
      const minOffsetX = Math.min(0, -(totalWidth - chartWidth));

      // Aplicar límites
      newOffsetX = Math.max(minOffsetX, Math.min(maxOffsetX, newOffsetX));

      // NO cambiar offsetY - el paneo vertical puede causar que los precios se salgan de escala
      // El usuario debe usar zoom vertical (wheel sin ctrl) en lugar de paneo vertical

      setOffsetX(newOffsetX);
      // setOffsetY NO se modifica - permanece en 0 o en su valor de zoom
      setManualPan(true); // Marcar que el usuario hizo paneo manual
    };

    // Mouse up - terminar drag
    const handleMouseUp = () => {
      setIsDragging(false);
    };

    // Mouse wheel - zoom vertical o horizontal según teclas modificadoras
    const handleWheel = (e) => {
      e.preventDefault();

      // Deshabilitar wheel durante drag
      if (isDragging) return;

      if (e.ctrlKey) {
        // Ctrl + wheel: zoom horizontal (ultra suave - 0.5% por paso)
        const zoomFactor = e.deltaY > 0 ? 0.995 : 1.005; // 0.5% por paso para zoom ultra suave
        setScaleX(prev => {
          const newScale = Math.max(0.1, Math.min(10, prev * zoomFactor)); // Límite: 0.1x a 10x
          // NO establecer manualPan = true aquí
          // Permitir que el auto-scroll ajuste el offsetX automáticamente basándose en el nuevo scale
          return newScale;
        });
      } else {
        // Wheel normal: zoom vertical (precio) - suave 1% por paso
        const zoomFactor = e.deltaY > 0 ? 0.99 : 1.01; // 1% por paso
        setScaleY(prev => Math.max(0.5, Math.min(5, prev * zoomFactor))); // Límite: 0.5x a 5x
      }
    };

    // Doble click - fit screen en eje vertical (precios)
    const handleDoubleClick = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;

      // Verificar si el click fue en el área del eje vertical (derecha)
      // El eje de precios está en los últimos 80px a la derecha
      if (x > width - 80) {
        // Resetear zoom vertical
        setScaleY(1);
        console.log('[BacktestingChart] Fit screen - zoom vertical reseteado');
      }
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('dblclick', handleDoubleClick);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('dblclick', handleDoubleClick);
    };
  }, [isDragging, dragStart, offsetX]);

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
      {/* Botón para ir a última vela */}
      <div className="chart-controls" style={{
        position: 'absolute',
        top: '10px',
        right: '100px',
        zIndex: 10
      }}>
        <button
          onClick={goToLastCandle}
          className="btn-go-to-last"
          title="Ir a la última vela y resetear zoom"
          style={{
            padding: '8px 12px',
            backgroundColor: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 'bold',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
          }}
        >
          ⏭️ Última Vela
        </button>
      </div>

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
        <canvas
          ref={chartCanvasRef}
          className={`chart-canvas ${isDragging ? 'dragging' : ''}`}
        ></canvas>
        {/* <canvas ref={drawingCanvasRef} className="drawing-canvas"></canvas> */}
      </div>
    </div>
  );
};

export default BacktestingChart;
