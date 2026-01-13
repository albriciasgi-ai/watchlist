import React, { useState, useEffect } from 'react';
import RealTimeAlertsTab from './RealTimeAlertsTab';
import StrategyTesterTab from './StrategyTesterTab';
import './SlidingAlertPanel.css';

/**
 * Panel deslizante con dos tabs:
 * 1. Alertas en Tiempo Real - alertas enviadas con seguimiento de trades
 * 2. Tester de Estrategias - backtesting sobre datos históricos
 */
const SlidingAlertPanel = ({ isOpen, onClose, fullscreenSymbol, fullscreenInterval }) => {
  const [activeTab, setActiveTab] = useState('realtime'); // 'realtime' | 'tester'

  return (
    <>
      {/* Overlay oscuro cuando está abierto */}
      <div
        className={`sliding-panel-overlay ${isOpen ? 'open' : ''}`}
        onClick={onClose}
      />

      {/* Panel deslizante */}
      <div className={`sliding-alert-panel ${isOpen ? 'open' : ''}`}>
        {/* Header con tabs */}
        <div className="panel-header">
          <div className="header-tabs">
            <button
              className={`tab-btn ${activeTab === 'realtime' ? 'active' : ''}`}
              onClick={() => setActiveTab('realtime')}
            >
              <span className="tab-icon">📡</span>
              Alertas Tiempo Real
            </button>
            <button
              className={`tab-btn ${activeTab === 'tester' ? 'active' : ''}`}
              onClick={() => setActiveTab('tester')}
            >
              <span className="tab-icon">🧪</span>
              Tester de Estrategias
            </button>
          </div>
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Contenido del tab activo */}
        {activeTab === 'realtime' ? (
          <RealTimeAlertsTab isOpen={isOpen} />
        ) : (
          <StrategyTesterTab
            isOpen={isOpen}
            fullscreenSymbol={fullscreenSymbol}
            fullscreenInterval={fullscreenInterval}
          />
        )}
      </div>
    </>
  );
};

/**
 * Botón flotante para abrir el panel
 */
export const AlertPanelToggle = ({ onClick, alertCount }) => {
  return (
    <button
      className="alert-panel-toggle"
      onClick={onClick}
      title="Ver historial de alertas"
    >
      <span className="toggle-icon">📊</span>
      {alertCount > 0 && (
        <span className="toggle-badge">{alertCount > 99 ? '99+' : alertCount}</span>
      )}
    </button>
  );
};

export default SlidingAlertPanel;
