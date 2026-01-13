import React, { useState } from 'react';
import { useGlobalAlerts } from '../../hooks/useGlobalAlerts';
import './SlidingAlertPanel.css';

/**
 * Panel deslizante de historial de alertas
 * Se despliega desde el lado derecho de la pantalla
 */
const SlidingAlertPanel = ({ isOpen, onClose }) => {
  const { alerts, isLoading, clearAlerts, exportToCSV, alertCount } = useGlobalAlerts();
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  const handleClearClick = () => {
    setShowConfirmClear(true);
  };

  const handleConfirmClear = () => {
    clearAlerts();
    setShowConfirmClear(false);
  };

  const handleCancelClear = () => {
    setShowConfirmClear(false);
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit'
    });
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatPrice = (value) => {
    if (value === null || value === undefined) return '-';
    return `$${value.toFixed(2)}`;
  };

  const formatPercent = (value) => {
    if (value === null || value === undefined) return '-';
    return `${value.toFixed(2)}%`;
  };

  const getDirectionClass = (direction) => {
    if (direction === 'LONG') return 'direction-long';
    if (direction === 'SHORT') return 'direction-short';
    return '';
  };

  const getIndicatorLabel = (indicator) => {
    const labels = {
      'DTB': 'Double Top/Bottom',
      'Rejection': 'Rejection Pattern'
    };
    return labels[indicator] || indicator;
  };

  return (
    <>
      {/* Overlay oscuro cuando está abierto */}
      <div
        className={`sliding-panel-overlay ${isOpen ? 'open' : ''}`}
        onClick={onClose}
      />

      {/* Panel deslizante */}
      <div className={`sliding-alert-panel ${isOpen ? 'open' : ''}`}>
        {/* Header */}
        <div className="panel-header">
          <div className="header-title">
            <span className="header-icon">📊</span>
            <h2>Historial de Alertas</h2>
            <span className="alert-count">{alertCount}</span>
          </div>
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Toolbar */}
        <div className="panel-toolbar">
          <button
            className="toolbar-btn export-btn"
            onClick={exportToCSV}
            disabled={alertCount === 0}
            title="Exportar a CSV"
          >
            📥 Exportar CSV
          </button>
          <button
            className="toolbar-btn clear-btn"
            onClick={handleClearClick}
            disabled={alertCount === 0}
            title="Limpiar historial"
          >
            🗑️ Limpiar
          </button>
        </div>

        {/* Confirmación de limpieza */}
        {showConfirmClear && (
          <div className="confirm-clear">
            <span>¿Eliminar todas las alertas?</span>
            <div className="confirm-buttons">
              <button onClick={handleConfirmClear} className="confirm-yes">Sí</button>
              <button onClick={handleCancelClear} className="confirm-no">No</button>
            </div>
          </div>
        )}

        {/* Contenido */}
        <div className="panel-content">
          {isLoading ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <span>Cargando alertas...</span>
            </div>
          ) : alertCount === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">📭</span>
              <p>No hay alertas registradas</p>
              <p className="empty-hint">Las alertas aparecerán aquí cuando se detecten patrones</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="alerts-table">
                <thead>
                  <tr>
                    <th>Moneda</th>
                    <th>Fecha</th>
                    <th>Hora</th>
                    <th>TF</th>
                    <th>Indicador</th>
                    <th>Dirección</th>
                    <th>Entrada</th>
                    <th>SL ($)</th>
                    <th>SL (%)</th>
                    <th>TP ($)</th>
                    <th>TP (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((alert, index) => (
                    <tr key={alert.id || index} className={getDirectionClass(alert.direction)}>
                      <td className="cell-symbol">
                        <span className="symbol-text">{alert.symbol?.replace('USDT', '')}</span>
                      </td>
                      <td className="cell-date">{formatDate(alert.timestamp)}</td>
                      <td className="cell-time">{formatTime(alert.timestamp)}</td>
                      <td className="cell-tf">{alert.interval}</td>
                      <td className="cell-indicator">
                        <span className={`indicator-badge ${alert.indicator?.toLowerCase()}`}>
                          {alert.indicator}
                        </span>
                      </td>
                      <td className="cell-direction">
                        <span className={`direction-badge ${alert.direction?.toLowerCase()}`}>
                          {alert.direction}
                        </span>
                      </td>
                      <td className="cell-price">{formatPrice(alert.entry)}</td>
                      <td className="cell-sl">{formatPrice(alert.stopLoss)}</td>
                      <td className="cell-sl-pct">{formatPercent(alert.slPercent)}</td>
                      <td className="cell-tp">{formatPrice(alert.takeProfit)}</td>
                      <td className="cell-tp-pct">{formatPercent(alert.tpPercent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer con información */}
        <div className="panel-footer">
          <span className="footer-info">
            Auto-actualización cada 3s • Máx. 100 alertas
          </span>
        </div>
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
