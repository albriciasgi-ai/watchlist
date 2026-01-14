// src/components/drawing/FloatingToolbar.jsx
// Toolbar flotante para modo dibujo inline en MiniChart

import React from 'react';
import './FloatingToolbar.css';

const FloatingToolbar = ({
  selectedTool,
  onSelectTool,
  onClose,
  compact = false,
  isFullscreen = false
}) => {
  // Herramientas disponibles - en modo compacto solo mostramos las esenciales
  const allTools = [
    { id: 'select', label: 'Cursor', icon: '↖', shortcut: 'V' },
    { id: 'horizontal', label: 'Horizontal', icon: '—', shortcut: 'H' },
    { id: 'trendline', label: 'Tendencia', icon: '📈', shortcut: 'T' },
    { id: 'fibonacci', label: 'Fibonacci', icon: 'φ', shortcut: 'F' },
    { id: 'rectangle', label: 'Rectángulo', icon: '▭', shortcut: 'R' },
    { id: 'tpsl', label: 'TP/SL', icon: '🎯', shortcut: 'P' },
  ];

  // En modo compacto, mostrar solo las herramientas esenciales
  const tools = compact
    ? allTools.filter(t => ['select', 'horizontal', 'trendline', 'fibonacci'].includes(t.id))
    : allTools;

  return (
    <div className={`floating-toolbar ${compact ? 'compact' : ''} ${isFullscreen ? 'fullscreen' : ''}`}>
      <div className="floating-toolbar-header">
        <span className="floating-toolbar-title">
          {compact ? '✏️' : '✏️ Modo Dibujo'}
        </span>
        <button
          className="floating-toolbar-close"
          onClick={onClose}
          title="Cerrar modo dibujo (ESC)"
        >
          ✕
        </button>
      </div>

      <div className="floating-toolbar-tools">
        {tools.map(tool => (
          <button
            key={tool.id}
            className={`floating-tool-btn ${selectedTool === tool.id ? 'active' : ''}`}
            onClick={() => onSelectTool(tool.id)}
            title={`${tool.label} (${tool.shortcut})`}
          >
            <span className="floating-tool-icon">{tool.icon}</span>
            {!compact && <span className="floating-tool-label">{tool.label}</span>}
          </button>
        ))}
      </div>

      <div className="floating-toolbar-hint">
        {compact
          ? 'Shift+DblClick: modal'
          : '💡 Shift+DblClick para abrir modal completo'
        }
      </div>
    </div>
  );
};

export default FloatingToolbar;
