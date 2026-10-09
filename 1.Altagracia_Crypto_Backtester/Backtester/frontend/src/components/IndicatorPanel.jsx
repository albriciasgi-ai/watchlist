// src/components/IndicatorPanel.jsx
// Sistema profesional de gestión de paneles de indicadores
// - Resize con drag handles verticales
// - Reordenamiento con drag and drop
// - Persistencia en localStorage por símbolo

import React, { useState, useRef, useEffect, useCallback } from 'react';
import './IndicatorPanel.css';

const IndicatorPanel = ({
  symbol,
  indicators,
  visibleCandles,
  bounds,
  onLayoutChange
}) => {
  const [layout, setLayout] = useState(() => loadLayoutFromStorage(symbol, indicators));
  const [resizing, setResizing] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const panelsRef = useRef({});

  // Cargar configuración guardada del localStorage
  function loadLayoutFromStorage(symbol, indicators) {
    // 🎯 DEFENSIVE: Verificar que tenemos datos válidos
    if (!symbol || !indicators || !Array.isArray(indicators) || indicators.length === 0) {
      console.warn('[IndicatorPanel] loadLayoutFromStorage: datos inválidos, retornando layout vacío');
      return { order: [], heights: {} };
    }

    const storageKey = `indicator_layout_${symbol}`;
    const saved = localStorage.getItem(storageKey);

    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.warn('[IndicatorPanel] Error parsing saved layout, using defaults');
      }
    }

    // Layout por defecto basado en los indicadores actuales
    const enabledIndicators = indicators.filter(ind => {
      if (!ind || !ind.name) return false;
      const height = ind.getHeight ? ind.getHeight() : (ind.height || 0);
      return ind.enabled && height > 0;
    });

    const order = enabledIndicators.map(ind => ind.name);
    const heights = {};

    enabledIndicators.forEach(ind => {
      heights[ind.name] = ind.height || 80;
    });

    return { order, heights };
  }

  // Guardar en localStorage cuando cambia el layout
  useEffect(() => {
    const storageKey = `indicator_layout_${symbol}`;
    localStorage.setItem(storageKey, JSON.stringify(layout));

    if (onLayoutChange) {
      onLayoutChange(layout);
    }

    console.log(`[IndicatorPanel] Layout guardado:`, layout);
  }, [layout, symbol, onLayoutChange]);

  // ==================== RESIZE HANDLING ====================

  const handleResizeStart = useCallback((index, e) => {
    e.preventDefault();
    const indicatorName = layout.order[index];
    const currentHeight = layout.heights[indicatorName];

    setResizing({
      index,
      indicatorName,
      startY: e.clientY,
      startHeight: currentHeight
    });

    // Cambiar cursor globalmente
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [layout]);

  const handleResizeMove = useCallback((e) => {
    if (!resizing) return;

    const deltaY = e.clientY - resizing.startY;
    const newHeight = Math.max(40, Math.min(400, resizing.startHeight + deltaY));

    setLayout(prev => ({
      ...prev,
      heights: {
        ...prev.heights,
        [resizing.indicatorName]: newHeight
      }
    }));
  }, [resizing]);

  const handleResizeEnd = useCallback(() => {
    if (!resizing) return;

    setResizing(null);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    console.log(`[IndicatorPanel] Resize completado: ${resizing.indicatorName} → ${layout.heights[resizing.indicatorName]}px`);
  }, [resizing, layout]);

  // Event listeners para resize
  useEffect(() => {
    if (resizing) {
      window.addEventListener('mousemove', handleResizeMove);
      window.addEventListener('mouseup', handleResizeEnd);

      return () => {
        window.removeEventListener('mousemove', handleResizeMove);
        window.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [resizing, handleResizeMove, handleResizeEnd]);

  // ==================== DRAG AND DROP HANDLING ====================

  const handleDragStart = useCallback((index, e) => {
    setDragging(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());

    // Hacer el elemento arrastrado semi-transparente
    if (e.target) {
      setTimeout(() => {
        e.target.style.opacity = '0.4';
      }, 0);
    }
  }, []);

  const handleDragEnd = useCallback((e) => {
    if (e.target) {
      e.target.style.opacity = '1';
    }
    setDragging(null);
    setDragOverIndex(null);
  }, []);

  const handleDragOver = useCallback((index, e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (dragging !== null && dragging !== index) {
      setDragOverIndex(index);
    }
  }, [dragging]);

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback((targetIndex, e) => {
    e.preventDefault();

    if (dragging === null || dragging === targetIndex) {
      setDragOverIndex(null);
      return;
    }

    // Reordenar el array
    const newOrder = [...layout.order];
    const [draggedItem] = newOrder.splice(dragging, 1);
    newOrder.splice(targetIndex, 0, draggedItem);

    setLayout(prev => ({
      ...prev,
      order: newOrder
    }));

    setDragging(null);
    setDragOverIndex(null);

    console.log(`[IndicatorPanel] Reordenado: ${draggedItem} movido a posición ${targetIndex}`);
  }, [dragging, layout.order]);

  // ==================== UTILITY FUNCTIONS ====================

  const resetHeight = useCallback((indicatorName) => {
    const indicator = indicators.find(ind => ind.name === indicatorName);
    if (!indicator) return;

    setLayout(prev => ({
      ...prev,
      heights: {
        ...prev.heights,
        [indicatorName]: indicator.height || 80
      }
    }));

    console.log(`[IndicatorPanel] Altura reseteada: ${indicatorName} → ${indicator.height}px`);
  }, [indicators]);

  const minimizePanel = useCallback((indicatorName) => {
    setLayout(prev => ({
      ...prev,
      heights: {
        ...prev.heights,
        [indicatorName]: 40
      }
    }));
  }, []);

  const maximizePanel = useCallback((indicatorName) => {
    setLayout(prev => ({
      ...prev,
      heights: {
        ...prev.heights,
        [indicatorName]: 200
      }
    }));
  }, []);

  // ==================== RENDER ====================

  // 🎯 DEFENSIVE: Filtrar solo indicadores habilitados y que tienen altura
  const enabledIndicators = (indicators && Array.isArray(indicators))
    ? indicators.filter(ind => {
        if (!ind) return false;
        const hasGetHeight = typeof ind.getHeight === 'function';
        return ind.enabled && hasGetHeight && ind.getHeight() > 0;
      })
    : [];

  // Asegurar que todos los indicadores habilitados están en el layout
  useEffect(() => {
    const currentNames = new Set(layout.order);
    const enabledNames = enabledIndicators.map(ind => ind.name);

    // Agregar nuevos indicadores habilitados
    const newIndicators = enabledNames.filter(name => !currentNames.has(name));

    // Remover indicadores deshabilitados
    const validOrder = layout.order.filter(name =>
      enabledIndicators.find(ind => ind.name === name)
    );

    if (newIndicators.length > 0 || validOrder.length !== layout.order.length) {
      setLayout(prev => {
        const newOrder = [...validOrder, ...newIndicators];
        const newHeights = { ...prev.heights };

        // Agregar alturas por defecto para nuevos indicadores
        newIndicators.forEach(name => {
          const indicator = enabledIndicators.find(ind => ind.name === name);
          newHeights[name] = indicator?.height || 80;
        });

        return { order: newOrder, heights: newHeights };
      });
    }
  }, [enabledIndicators, layout]);

  // 🎯 DEFENSIVE: No renderizar si no hay datos válidos
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    console.warn('[IndicatorPanel] Bounds inválidos, no renderizando');
    return null;
  }

  if (!layout || !layout.order || layout.order.length === 0) {
    console.warn('[IndicatorPanel] Layout vacío, no renderizando');
    return null;
  }

  if (enabledIndicators.length === 0) {
    console.warn('[IndicatorPanel] No hay indicadores habilitados, no renderizando');
    return null;
  }

  // Renderizar cada panel
  return (
    <div className="indicator-panels-container" style={{
      position: 'absolute',
      left: bounds.x,
      top: bounds.y,
      width: bounds.width,
      height: bounds.height
    }}>
      {layout.order.map((indicatorName, index) => {
        const indicator = enabledIndicators.find(ind => ind.name === indicatorName);
        if (!indicator) return null;

        const height = layout.heights[indicatorName] || 80;
        const isDragging = dragging === index;
        const isDragOver = dragOverIndex === index;

        return (
          <React.Fragment key={indicatorName}>
            <div
              className={`indicator-panel ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
              style={{ height: `${height}px` }}
              onDragOver={(e) => handleDragOver(index, e)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(index, e)}
            >
              {/* Header con drag handle y controles - SOLO EL HEADER ES DRAGGABLE */}
              <div
                className="panel-header"
                draggable
                onDragStart={(e) => handleDragStart(index, e)}
                onDragEnd={handleDragEnd}
                style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                title="Arrastra este header para reordenar los indicadores"
              >
                <span className="drag-handle" title="🔀 Arrastra aquí para reordenar">≡</span>
                <span className="panel-title">{indicatorName}</span>

                <div className="panel-actions">
                  <button
                    className="panel-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      minimizePanel(indicatorName);
                    }}
                    title="Minimizar panel (40px)"
                  >
                    ➖
                  </button>
                  <button
                    className="panel-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      resetHeight(indicatorName);
                    }}
                    title="Restablecer altura por defecto"
                  >
                    ↕️
                  </button>
                  <button
                    className="panel-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      maximizePanel(indicatorName);
                    }}
                    title="Maximizar panel (200px)"
                  >
                    ⬜
                  </button>
                </div>
              </div>

              {/* Canvas del indicador */}
              <div
                className="panel-content"
                ref={el => {
                  if (el) {
                    panelsRef.current[indicatorName] = el;

                    // 🎯 DEFENSIVE: Solo renderizar si tenemos todos los datos necesarios
                    const canvas = el.querySelector('canvas');
                    if (canvas && indicator.render && visibleCandles && visibleCandles.length > 0) {
                      try {
                        const ctx = canvas.getContext('2d');
                        const rect = el.getBoundingClientRect();

                        // Verificar que tenemos dimensiones válidas
                        if (rect.width <= 0 || rect.height <= 0) {
                          console.warn(`[IndicatorPanel] Dimensiones inválidas para ${indicatorName}`);
                          return;
                        }

                        // Ajustar canvas al tamaño del contenedor
                        if (canvas.width !== rect.width || canvas.height !== rect.height) {
                          canvas.width = rect.width;
                          canvas.height = rect.height;
                        }

                        // Calcular bounds para el indicador
                        const indicatorBounds = {
                          x: 0,
                          y: 0,
                          width: rect.width,
                          height: rect.height
                        };

                        // Renderizar con try-catch para capturar errores
                        indicator.render(ctx, indicatorBounds, visibleCandles);
                      } catch (error) {
                        console.error(`[IndicatorPanel] Error renderizando ${indicatorName}:`, error);
                      }
                    }
                  }
                }}
              >
                <canvas />
              </div>
            </div>

            {/* Resize handle entre paneles */}
            {index < layout.order.length - 1 && (
              <div
                className={`resize-handle ${resizing?.index === index ? 'active' : ''}`}
                onMouseDown={(e) => handleResizeStart(index, e)}
                title="⬍⬍ Arrastra para cambiar la altura del panel ⬍⬍"
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default IndicatorPanel;
