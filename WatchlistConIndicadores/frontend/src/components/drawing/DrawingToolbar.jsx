// src/components/drawing/DrawingToolbar.jsx
// Toolbar con herramientas de dibujo

import React from 'react';
import './DrawingToolbar.css';

const DrawingToolbar = ({ selectedTool, onToolChange, onUndo, onRedo, onClearAll }) => {
  const tools = [
    { id: 'select', label: 'Cursor', icon: '↖', shortcut: 'V' },
    { id: 'trendline', label: 'Línea de Tendencia', icon: '📈', shortcut: 'T' },
    { id: 'horizontal', label: 'Línea Horizontal', icon: '—', shortcut: 'H' },
    { id: 'vertical', label: 'Línea Vertical', icon: '|', shortcut: 'L' },
    { id: 'rectangle', label: 'Rectángulo', icon: '▭', shortcut: 'R' },
    { id: 'fibonacci', label: 'Fibonacci', icon: 'φ', shortcut: 'F' }
  ];

  return (
    <div className="drawing-toolbar">
      <div className="toolbar-section">
        <span className="toolbar-label">Herramientas:</span>
        {tools.map(tool => (
          <button
            key={tool.id}
            className={`toolbar-btn ${selectedTool === tool.id ? 'active' : ''}`}
            onClick={() => onToolChange(tool.id)}
            title={`${tool.label} (${tool.shortcut})`}
          >
            <span className="tool-icon">{tool.icon}</span>
            <span className="tool-label">{tool.label}</span>
          </button>
        ))}
      </div>

      <div className="toolbar-divider"></div>

      <div className="toolbar-section">
        <button
          className="toolbar-btn"
          onClick={onUndo}
          title="Deshacer (Ctrl+Z)"
        >
          <span className="tool-icon">↶</span>
          <span className="tool-label">Deshacer</span>
        </button>

        <button
          className="toolbar-btn"
          onClick={onRedo}
          title="Rehacer (Ctrl+Y)"
        >
          <span className="tool-icon">↷</span>
          <span className="tool-label">Rehacer</span>
        </button>

        <button
          className="toolbar-btn danger"
          onClick={onClearAll}
          title="Limpiar todo"
        >
          <span className="tool-icon">🗑</span>
          <span className="tool-label">Limpiar</span>
        </button>
      </div>

      <div className="toolbar-helper">
        <span>💡 Rueda del mouse para medir | Esc para cancelar | Del para borrar</span>
      </div>
    </div>
  );
};

export default DrawingToolbar;
