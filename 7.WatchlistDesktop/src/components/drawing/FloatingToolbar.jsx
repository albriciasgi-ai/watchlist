// src/components/drawing/FloatingToolbar.jsx
// Toolbar flotante para modo dibujo inline en MiniChart

import React, { useEffect, useState, useRef, useCallback } from 'react';

const FloatingToolbar = ({
  selectedTool,
  onSelectTool,
  onClose,
  onUndo,
  onRedo,
  onClearAll,
  compact = false,
  isFullscreen = false,
  canvasRef = null
}) => {
  const [position, setPosition] = useState({ top: 100, left: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const toolbarRef = useRef(null);

  // Calcular posición relativa al canvas
  useEffect(() => {
    if (canvasRef?.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const newPos = {
        top: rect.top + 50,
        left: rect.left + 10
      };
      setPosition(newPos);
    }
  }, [canvasRef]);

  // 🖱️ Drag handlers
  const handleDragStart = (e) => {
    if (e.target.tagName === 'BUTTON') return; // No iniciar drag en botones
    e.preventDefault();
    setIsDragging(true);
    const rect = toolbarRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  };

  const handleDragMove = useCallback((e) => {
    if (!isDragging) return;
    setPosition({
      top: e.clientY - dragOffset.y,
      left: e.clientX - dragOffset.x
    });
  }, [isDragging, dragOffset]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Listeners globales para drag
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      return () => {
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
      };
    }
  }, [isDragging, handleDragMove, handleDragEnd]);

  // Herramientas de dibujo (todas las del ChartModal)
  const drawingTools = [
    { id: 'select', label: 'Cursor', icon: '↖', shortcut: 'V' },
    { id: 'trendline', label: 'Tendencia', icon: '📈', shortcut: 'T' },
    { id: 'horizontal', label: 'Horizontal', icon: '—', shortcut: 'H' },
    { id: 'vertical', label: 'Vertical', icon: '|', shortcut: 'L' },
    { id: 'rectangle', label: 'Rectángulo', icon: '▭', shortcut: 'R' },
    { id: 'fibonacci', label: 'Fibonacci', icon: 'φ', shortcut: 'F' },
    { id: 'tpsl', label: 'TP/SL Long', icon: '🎯', shortcut: 'P' },
    { id: 'tpsl-short', label: 'TP/SL Short', icon: '🔻', shortcut: 'S' },
    { id: 'textbox', label: 'Texto', icon: '📝', shortcut: 'N' },
  ];

  const btnStyle = (isActive) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    border: isActive ? '2px solid #3b82f6' : '1px solid #d1d5db',
    background: isActive ? '#3b82f6' : '#ffffff',
    color: isActive ? '#ffffff' : '#374151',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '500',
  });

  const actionBtnStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px 8px',
    border: '1px solid #d1d5db',
    background: '#ffffff',
    color: '#374151',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
  };

  const dangerBtnStyle = {
    ...actionBtnStyle,
    background: '#fee2e2',
    color: '#dc2626',
    border: '1px solid #fecaca',
  };

  const containerStyle = {
    position: 'fixed',
    top: `${position.top}px`,
    left: `${position.left}px`,
    zIndex: 10000,
    background: 'rgba(255, 255, 255, 0.98)',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    padding: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: '160px',
    maxHeight: '90vh',
    overflowY: 'auto',
  };

  return (
    <div style={containerStyle} id="floating-toolbar-inline" ref={toolbarRef}>
      {/* Header - Draggable */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #e5e7eb',
          paddingBottom: '8px',
          cursor: isDragging ? 'grabbing' : 'grab'
        }}
        onMouseDown={handleDragStart}
      >
        <span style={{ fontWeight: '600', fontSize: '13px', color: '#374151', userSelect: 'none' }}>⋮⋮ Dibujo</span>
        <button
          onClick={onClose}
          style={{
            background: '#fee2e2',
            border: 'none',
            borderRadius: '4px',
            width: '24px',
            height: '24px',
            cursor: 'pointer',
            fontSize: '14px',
            color: '#dc2626'
          }}
          title="Cerrar (ESC)"
        >
          ✕
        </button>
      </div>

      {/* Herramientas de dibujo */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {drawingTools.map(tool => (
          <button
            key={tool.id}
            style={btnStyle(selectedTool === tool.id)}
            onClick={() => onSelectTool(tool.id)}
            title={`${tool.label} (${tool.shortcut})`}
          >
            <span style={{ fontSize: '14px', width: '20px', textAlign: 'center' }}>{tool.icon}</span>
            <span>{tool.label}</span>
            <span style={{ marginLeft: 'auto', fontSize: '10px', opacity: 0.6 }}>{tool.shortcut}</span>
          </button>
        ))}
      </div>

      {/* Separador */}
      <div style={{ borderTop: '1px solid #e5e7eb', margin: '4px 0' }} />

      {/* Acciones: Undo, Redo, Clear */}
      <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
        <button
          style={actionBtnStyle}
          onClick={onUndo}
          title="Deshacer (Ctrl+Z)"
        >
          ↶
        </button>
        <button
          style={actionBtnStyle}
          onClick={onRedo}
          title="Rehacer (Ctrl+Y)"
        >
          ↷
        </button>
        <button
          style={dangerBtnStyle}
          onClick={onClearAll}
          title="Limpiar todo"
        >
          🗑
        </button>
      </div>

      {/* Ayuda */}
      <div style={{ fontSize: '9px', color: '#9ca3af', textAlign: 'center', paddingTop: '4px', borderTop: '1px solid #e5e7eb', lineHeight: '1.4' }}>
        Del: borrar | C: color<br/>
        Shift+DblClick: modal
      </div>
    </div>
  );
};

export default FloatingToolbar;
