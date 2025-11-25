// src/components/drawing/DrawingToolbar.jsx
// Toolbar con herramientas de dibujo

import React, { useState } from 'react';
import './DrawingToolbar.css';

const DrawingToolbar = ({ selectedTool, onToolChange, onUndo, onRedo, onClearAll }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const tools = [
    { id: 'select', label: 'Cursor', icon: '↖', shortcut: 'V' },
    { id: 'trendline', label: 'Línea', icon: '📈', shortcut: 'T' },
    { id: 'horizontal', label: 'H-Line', icon: '—', shortcut: 'H' },
    { id: 'vertical', label: 'V-Line', icon: '|', shortcut: 'L' },
    { id: 'rectangle', label: 'Rect', icon: '▭', shortcut: 'R' },
    { id: 'fibonacci', label: 'Fib', icon: 'φ', shortcut: 'F' },
    { id: 'tpsl', label: 'TP/SL L', icon: '🎯', shortcut: 'P' },
    { id: 'tpsl-short', label: 'TP/SL S', icon: '🔻', shortcut: 'S' },
    { id: 'textbox', label: 'Texto', icon: '📝', shortcut: 'N' }
  ];

  return (
    <div className={`drawing-toolbar ${isCollapsed ? 'collapsed' : ''}`}>
      {/* Botón de colapsar/expandir */}
      <button
        className="toolbar-toggle-btn"
        onClick={() => setIsCollapsed(!isCollapsed)}
        title={isCollapsed ? 'Expandir herramientas' : 'Colapsar herramientas'}
      >
        {isCollapsed ? '☰' : '✕'}
      </button>

      {!isCollapsed && (
        <>
          <div className="toolbar-section">
            {tools.map(tool => (
              <button
                key={tool.id}
                className={`toolbar-btn-compact ${selectedTool === tool.id ? 'active' : ''}`}
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
              className="toolbar-btn-compact"
              onClick={onUndo}
              title="Deshacer (Ctrl+Z)"
            >
              <span className="tool-icon">↶</span>
            </button>

            <button
              className="toolbar-btn-compact"
              onClick={onRedo}
              title="Rehacer (Ctrl+Y)"
            >
              <span className="tool-icon">↷</span>
            </button>

            <button
              className="toolbar-btn-compact danger"
              onClick={onClearAll}
              title="Limpiar todo"
            >
              <span className="tool-icon">🗑</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default DrawingToolbar;
