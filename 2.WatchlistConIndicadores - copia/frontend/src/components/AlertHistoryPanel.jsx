// src/components/AlertHistoryPanel.jsx
// Panel para mostrar historial de alertas del indicador Double Top/Bottom

import React, { useState, useEffect } from 'react';
import './AlertHistoryPanel.css';

const AlertHistoryPanel = ({ symbol, onClose }) => {
  const [alerts, setAlerts] = useState([]);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Cargar alertas desde localStorage
  const loadAlerts = () => {
    try {
      const storageKey = `dbt_alert_history_${symbol}`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsedAlerts = JSON.parse(stored);
        setAlerts(parsedAlerts);
      } else {
        setAlerts([]);
      }
    } catch (error) {
      console.error('[AlertHistoryPanel] Error loading alerts:', error);
      setAlerts([]);
    }
  };

  // Cargar alertas al montar
  useEffect(() => {
    loadAlerts();
  }, [symbol]);

  // Auto-refresh cada 5 segundos si está habilitado
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadAlerts();
    }, 5000);

    return () => clearInterval(interval);
  }, [autoRefresh, symbol]);

  // Limpiar historial
  const handleClearHistory = () => {
    if (confirm('¿Eliminar todo el historial de alertas?')) {
      const storageKey = `dbt_alert_history_${symbol}`;
      localStorage.removeItem(storageKey);
      setAlerts([]);
    }
  };

  // Formatear timestamp
  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Ahora';
    if (diffMins < 60) return `Hace ${diffMins}m`;
    if (diffHours < 24) return `Hace ${diffHours}h`;
    if (diffDays < 7) return `Hace ${diffDays}d`;

    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Obtener color del badge según nivel
  const getLevelColor = (level) => {
    switch (level) {
      case 'critical': return '#F44336';
      case 'high': return '#FF9800';
      case 'medium': return '#FFC107';
      default: return '#9E9E9E';
    }
  };

  // Obtener icono según tipo de patrón
  const getPatternIcon = (type) => {
    return type === 'DOUBLE_TOP' ? '📉' : '📈';
  };

  return (
    <div className="alert-history-panel">
      <div className="alert-history-header">
        <h3>
          🔔 Historial de Alertas - {symbol}
        </h3>
        <div className="alert-history-controls">
          <label className="auto-refresh-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto-refresh</span>
          </label>
          <button
            className="btn-refresh"
            onClick={loadAlerts}
            title="Refrescar ahora"
          >
            🔄
          </button>
          <button
            className="btn-clear"
            onClick={handleClearHistory}
            title="Limpiar historial"
          >
            🗑️
          </button>
          <button
            className="btn-close"
            onClick={onClose}
            title="Cerrar"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="alert-history-body">
        {alerts.length === 0 ? (
          <div className="no-alerts">
            <p>No hay alertas registradas</p>
          </div>
        ) : (
          <div className="alerts-list">
            {alerts.map((alert, index) => (
              <div
                key={index}
                className={`alert-item ${alert.level || 'none'}`}
              >
                <div className="alert-header-row">
                  <div className="alert-icon">
                    {getPatternIcon(alert.patternType)}
                  </div>
                  <div className="alert-type">
                    <span className="pattern-type">
                      {alert.patternType.replace('_', ' ')}
                    </span>
                    <span className="direction-badge" data-direction={alert.direction}>
                      {alert.direction}
                    </span>
                  </div>
                  <div className="alert-time">
                    {formatTime(alert.timestamp)}
                  </div>
                </div>

                <div className="alert-details-row">
                  <div className="alert-metric">
                    <span className="metric-label">Nivel:</span>
                    <span
                      className="level-badge"
                      style={{ backgroundColor: getLevelColor(alert.level) }}
                    >
                      {alert.level ? alert.level.toUpperCase() : 'N/A'}
                    </span>
                  </div>
                  <div className="alert-metric">
                    <span className="metric-label">Confianza:</span>
                    <span className="metric-value">{alert.confidence}%</span>
                  </div>
                  <div className="alert-metric">
                    <span className="metric-label">Momentum:</span>
                    <span className="metric-value">
                      {alert.hasMomentum ? '✅' : '❌'}
                    </span>
                  </div>
                </div>

                {alert.vwapAligned !== undefined && (
                  <div className="alert-vwap-row">
                    <span className="vwap-label">VWAP Filter:</span>
                    <span className="vwap-status">
                      {alert.vwapAligned ? '✅ Aligned' : '❌ Not aligned'}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="alert-history-footer">
        <span className="alerts-count">
          {alerts.length} alerta{alerts.length !== 1 ? 's' : ''} (máx. 20)
        </span>
      </div>
    </div>
  );
};

export default AlertHistoryPanel;
