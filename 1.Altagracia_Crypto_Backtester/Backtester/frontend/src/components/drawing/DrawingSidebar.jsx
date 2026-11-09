// src/components/drawing/DrawingSidebar.jsx
// 🎯 OPTIMIZACIÓN UI: Sidebar vertical para herramientas de dibujo (reemplaza toolbar horizontal)

import React from 'react';
import './DrawingSidebar.css';
import { useUiTheme } from '../useUiTheme.js';
import { isNewTheme } from '../uiTheme.js';
import { Icon } from '../uiIcons.jsx';

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
    { id: 'select', label: 'Cursor', icon: '↖', svg: 'cursor', shortcut: 'V' },
    { id: 'trendline', label: 'Línea Tendencia', icon: '📈', svg: 'trend', shortcut: 'T' },
    { id: 'horizontal', label: 'Línea Horizontal', icon: '—', svg: 'hline', shortcut: 'H' },
    { id: 'vertical', label: 'Línea Vertical', icon: '|', svg: 'vline', shortcut: 'L' },
    { id: 'rectangle', label: 'Rectángulo', icon: '▭', svg: 'rect', shortcut: 'R' },
    { id: 'fibonacci', label: 'Fibonacci', icon: 'φ', svg: 'fib', shortcut: 'F' },
    { id: 'tpsl', label: 'TP/SL Long', icon: '🎯', svg: 'long', shortcut: 'P' },
    { id: 'tpsl-short', label: 'TP/SL Short', icon: '🔻', svg: 'short', shortcut: 'S' }
  ];

  // Estilo Nítido: íconos de línea con su nombre; al contraerla quedan solo los íconos
  useUiTheme();
  const isNew = isNewTheme();
  const compact = isCollapsed;

  return (
    <div className={`drawing-sidebar ${compact ? 'collapsed' : ''} ${isHidden ? 'hidden' : ''}`}>
      {/* Header con botón de colapsar */}
      <div className="sidebar-header-draw">
        <span className="sidebar-title-draw">
          {isNew
            ? <><Icon name="pencil" size={15} />{!isCollapsed && <span>Dibujo</span>}</>
            : (isCollapsed ? '🖌' : '🖌 Dibujo')}
        </span>
        <button
          className="btn-collapse-draw"
          onClick={onToggleCollapse}
          title={isCollapsed ? 'Click: Ocultar (D)' : 'Click: Contraer (D)'}
        >
          {isNew ? <Icon name={isCollapsed ? 'close' : 'chevronLeft'} size={13} /> : (isCollapsed ? '✕' : '◀')}
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
            <span className="tool-icon-side">{isNew ? <Icon name={tool.svg} size={18} /> : tool.icon}</span>
            {!compact && <span className="tool-label-side">{tool.label}</span>}
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
          <span className="action-icon">{isNew ? <Icon name="undo" size={17} /> : '↶'}</span>
          {!compact && <span className="action-label">Deshacer</span>}
        </button>

        <button
          className="sidebar-action-btn"
          onClick={onRedo}
          title="Rehacer (Ctrl+Y)"
        >
          <span className="action-icon">{isNew ? <Icon name="redo" size={17} /> : '↷'}</span>
          {!compact && <span className="action-label">Rehacer</span>}
        </button>

        <button
          className="sidebar-action-btn danger"
          onClick={onClearAll}
          title="Limpiar todo"
        >
          <span className="action-icon">{isNew ? <Icon name="trash" size={17} /> : '🗑'}</span>
          {!compact && <span className="action-label">Limpiar</span>}
        </button>
      </div>

      {/* Helper text solo cuando no está colapsado */}
      {!compact && (
        <div className="sidebar-helper">
          <div className="helper-item">{isNew ? 'Rueda: medir' : '💡 Rueda: medir'}</div>
          <div className="helper-item">Esc: cancelar</div>
          <div className="helper-item">Del: borrar</div>
        </div>
      )}
    </div>
  );
};

export default DrawingSidebar;
