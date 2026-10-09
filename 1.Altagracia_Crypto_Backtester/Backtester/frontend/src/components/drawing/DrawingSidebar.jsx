// src/components/drawing/DrawingSidebar.jsx
// 🎯 OPTIMIZACIÓN UI: Sidebar vertical para herramientas de dibujo (reemplaza toolbar horizontal)

import React from 'react';
import './DrawingSidebar.css';

const DrawingSidebar = ({
  selectedTool,
  onToolChange,
  onUndo,
  onRedo,
  onClearAll,
  isCollapsed = false,
  isHidden = false,
  onToggleCollapse
}) => {
  const tools = [
    { id: 'select', label: 'Cursor', icon: '↖', shortcut: 'V' },
    { id: 'trendline', label: 'Línea Tendencia', icon: '📈', shortcut: 'T' },
    { id: 'horizontal', label: 'Línea Horizontal', icon: '—', shortcut: 'H' },
    { id: 'vertical', label: 'Línea Vertical', icon: '|', shortcut: 'L' },
    { id: 'rectangle', label: 'Rectángulo', icon: '▭', shortcut: 'R' },
    { id: 'fibonacci', label: 'Fibonacci', icon: 'φ', shortcut: 'F' },
    { id: 'tpsl', label: 'TP/SL Long', icon: '🎯', shortcut: 'P' },
    { id: 'tpsl-short', label: 'TP/SL Short', icon: '🔻', shortcut: 'S' }
  ];

  return (
    <div className={`drawing-sidebar ${isCollapsed ? 'collapsed' : ''} ${isHidden ? 'hidden' : ''}`}>
      {/* Header con botón de colapsar */}
      <div className="sidebar-header-draw">
        <span className="sidebar-title-draw">
          {isCollapsed ? '🖌' : '🖌 Dibujo'}
        </span>
        <button
          className="btn-collapse-draw"
          onClick={onToggleCollapse}
          title={isCollapsed ? 'Click: Ocultar (D)' : 'Click: Contraer (D)'}
        >
          {isCollapsed ? '✕' : '◀'}
        </button>
      </div>

      {/* Sección de herramientas */}
      <div className="sidebar-tools">
        {tools.map(tool => (
          <button
            key={tool.id}
            className={`sidebar-tool-btn ${selectedTool === tool.id ? 'active' : ''}`}
            onClick={() => onToolChange(tool.id)}
            title={`${tool.label} (${tool.shortcut})`}
          >
            <span className="tool-icon-side">{tool.icon}</span>
            {!isCollapsed && <span className="tool-label-side">{tool.label}</span>}
          </button>
        ))}
      </div>

      {/* Divisor */}
      <div className="sidebar-divider"></div>

      {/* Sección de acciones */}
      <div className="sidebar-actions">
        <button
          className="sidebar-action-btn"
          onClick={onUndo}
          title="Deshacer (Ctrl+Z)"
        >
          <span className="action-icon">↶</span>
          {!isCollapsed && <span className="action-label">Deshacer</span>}
        </button>

        <button
          className="sidebar-action-btn"
          onClick={onRedo}
          title="Rehacer (Ctrl+Y)"
        >
          <span className="action-icon">↷</span>
          {!isCollapsed && <span className="action-label">Rehacer</span>}
        </button>

        <button
          className="sidebar-action-btn danger"
          onClick={onClearAll}
          title="Limpiar todo"
        >
          <span className="action-icon">🗑</span>
          {!isCollapsed && <span className="action-label">Limpiar</span>}
        </button>
      </div>

      {/* Helper text solo cuando no está colapsado */}
      {!isCollapsed && (
        <div className="sidebar-helper">
          <div className="helper-item">💡 Rueda: medir</div>
          <div className="helper-item">Esc: cancelar</div>
          <div className="helper-item">Del: borrar</div>
        </div>
      )}
    </div>
  );
};

export default DrawingSidebar;
