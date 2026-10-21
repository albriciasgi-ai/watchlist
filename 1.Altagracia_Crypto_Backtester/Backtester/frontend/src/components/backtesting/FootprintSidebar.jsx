import React, { useState, useEffect } from 'react';
import FootprintCard from './FootprintCard';
import './FootprintSidebar.css';

/**
 * FootprintSidebar - Panel lateral con hasta 10 footprints anclados
 *
 * @param {Object} props
 * @param {Array} props.pinnedFootprints - Array de timestamps anclados [ts1, ts2, ...]
 * @param {Function} props.onTogglePin - Callback para anclar/desanclar (timestamp)
 * @param {Function} props.onNavigate - Callback para navegar al gráfico (timestamp)
 * @param {Object} props.orderFlowIndicator - Referencia al OrderFlowIndicator para obtener datos
 */
const FootprintSidebar = ({
  pinnedFootprints = [],
  onTogglePin,
  onNavigate,
  orderFlowIndicator
}) => {
  const [footprintData, setFootprintData] = useState([]);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Actualizar datos de footprints cuando cambian los timestamps anclados
  useEffect(() => {
    if (!orderFlowIndicator || pinnedFootprints.length === 0) {
      setFootprintData([]);
      return;
    }

    // Obtener footprints del indicador
    const data = orderFlowIndicator.getFootprintsForTimestamps(pinnedFootprints);
    setFootprintData(data);

  }, [pinnedFootprints, orderFlowIndicator]);

  // Callback para desanclar un footprint
  const handleUnpin = (timestamp) => {
    if (onTogglePin) {
      onTogglePin(timestamp);
    }
  };

  // Callback para navegar a un footprint en el gráfico
  const handleNavigate = (timestamp) => {
    if (onNavigate) {
      onNavigate(timestamp);
    }
  };

  // Si no hay footprints anclados, mostrar mensaje
  if (pinnedFootprints.length === 0) {
    return (
      <div className="footprint-sidebar empty">
        <div className="sidebar-header">
          <span className="sidebar-title">📊 Order Flow</span>
        </div>
        <div className="empty-message">
          <p>📌 No hay footprints anclados</p>
          <p className="hint">Haz click en una vela del gráfico para anclar su footprint</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`footprint-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      {/* Header con botón de colapsar */}
      <div className="sidebar-header">
        <span className="sidebar-title">📊 Order Flow ({footprintData.length}/{pinnedFootprints.length})</span>
        <button
          className="collapse-button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          title={isCollapsed ? "Expandir sidebar" : "Colapsar sidebar"}
        >
          {isCollapsed ? '◀' : '▶'}
        </button>
      </div>

      {/* Contenido del sidebar */}
      {!isCollapsed && (
        <div className="sidebar-content">
          {/* Grid de footprint cards */}
          <div className="footprints-grid">
            {footprintData.map((footprint, idx) => (
              <div
                key={footprint.timestamp}
                className="card-wrapper"
                onClick={() => handleNavigate(footprint.timestamp)}
              >
                <FootprintCard
                  footprint={footprint}
                  index={idx + 1}
                  onUnpin={handleUnpin}
                />
              </div>
            ))}
          </div>

          {/* Info adicional */}
          <div className="sidebar-footer">
            <p className="info-text">
              💡 Click en un card para navegar al gráfico
            </p>
            <p className="info-text">
              📌 Click en el botón para desanclar
            </p>
            {pinnedFootprints.length >= 10 && (
              <p className="warning-text">
                ⚠️ Máximo 10 footprints alcanzado
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FootprintSidebar;
