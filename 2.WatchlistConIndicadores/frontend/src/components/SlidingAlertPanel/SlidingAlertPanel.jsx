import React, { useState, useMemo, useEffect } from 'react';
import { useGlobalAlerts } from '../../hooks/useGlobalAlerts';
import './SlidingAlertPanel.css';

const RISK_AMOUNT_KEY = 'watchlist_risk_amount';

/**
 * Panel deslizante de historial de alertas con tracking de resultados
 * Se despliega desde el lado derecho de la pantalla
 */
const SlidingAlertPanel = ({ isOpen, onClose }) => {
  const { alerts, isLoading, isEvaluating, clearAlerts, exportToCSV, alertCount, evaluatePendingOutcomes } = useGlobalAlerts();
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [riskAmount, setRiskAmount] = useState(() => {
    const stored = localStorage.getItem(RISK_AMOUNT_KEY);
    return stored ? parseFloat(stored) : 100;
  });

  // Guardar risk amount en localStorage cuando cambie
  useEffect(() => {
    localStorage.setItem(RISK_AMOUNT_KEY, riskAmount.toString());
  }, [riskAmount]);

  // Evaluar cuando se abre el panel
  useEffect(() => {
    if (isOpen) {
      evaluatePendingOutcomes();
    }
  }, [isOpen, evaluatePendingOutcomes]);

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

  const handleRiskChange = (e) => {
    const value = parseFloat(e.target.value) || 0;
    setRiskAmount(value);
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

  // Calcular P/L para cada alerta basado en el outcome y risk amount
  const calculatePL = (alert) => {
    if (!alert.outcome || alert.outcome === 'PENDING') {
      return { plPercent: null, plUSDT: null };
    }

    const slPercent = Math.abs(alert.slPercent || 0);
    const tpPercent = Math.abs(alert.tpPercent || 0);

    // Risk/Reward ratio
    const rr = slPercent > 0 ? tpPercent / slPercent : 0;

    if (alert.outcome === 'WIN') {
      // Ganancia = riskAmount * RR
      const plUSDT = riskAmount * rr;
      const plPercent = tpPercent;
      return { plPercent, plUSDT };
    } else if (alert.outcome === 'LOSS') {
      // Pérdida = -riskAmount
      const plUSDT = -riskAmount;
      const plPercent = -slPercent;
      return { plPercent, plUSDT };
    }

    return { plPercent: null, plUSDT: null };
  };

  // Calcular totales
  const totals = useMemo(() => {
    let totalWins = 0;
    let totalLosses = 0;
    let totalPLPercent = 0;
    let totalPLUSDT = 0;
    let completedTrades = 0;

    alerts.forEach(alert => {
      if (alert.outcome === 'WIN') {
        totalWins++;
        completedTrades++;
      } else if (alert.outcome === 'LOSS') {
        totalLosses++;
        completedTrades++;
      }

      const { plPercent, plUSDT } = calculatePL(alert);
      if (plPercent !== null) totalPLPercent += plPercent;
      if (plUSDT !== null) totalPLUSDT += plUSDT;
    });

    const winRate = completedTrades > 0 ? (totalWins / completedTrades * 100).toFixed(1) : 0;

    return {
      totalWins,
      totalLosses,
      completedTrades,
      winRate,
      totalPLPercent,
      totalPLUSDT
    };
  }, [alerts, riskAmount]);

  const getOutcomeClass = (outcome) => {
    if (outcome === 'WIN') return 'outcome-win';
    if (outcome === 'LOSS') return 'outcome-loss';
    return 'outcome-pending';
  };

  const formatPL = (value, isPercent = false) => {
    if (value === null || value === undefined) return '-';
    const sign = value >= 0 ? '+' : '';
    if (isPercent) {
      return `${sign}${value.toFixed(2)}%`;
    }
    return `${sign}$${value.toFixed(2)}`;
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
          <div className="risk-input-container">
            <label htmlFor="risk-amount">Riesgo por trade:</label>
            <div className="risk-input-wrapper">
              <span className="currency-symbol">$</span>
              <input
                type="number"
                id="risk-amount"
                value={riskAmount}
                onChange={handleRiskChange}
                min="0"
                step="10"
                className="risk-input"
              />
            </div>
          </div>
          <div className="toolbar-buttons">
            <button
              className={`toolbar-btn refresh-btn ${isEvaluating ? 'evaluating' : ''}`}
              onClick={evaluatePendingOutcomes}
              disabled={isEvaluating || alertCount === 0}
              title="Actualizar resultados de trades"
            >
              {isEvaluating ? '⏳' : '🔄'} {isEvaluating ? 'Evaluando...' : 'Evaluar'}
            </button>
            <button
              className="toolbar-btn export-btn"
              onClick={() => exportToCSV(riskAmount)}
              disabled={alertCount === 0}
              title="Exportar a CSV"
            >
              📥 CSV
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
                    <th>Resultado</th>
                    <th>P/L (%)</th>
                    <th>P/L ($)</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((alert, index) => {
                    const { plPercent, plUSDT } = calculatePL(alert);
                    return (
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
                        <td className="cell-outcome">
                          <span className={`outcome-badge ${getOutcomeClass(alert.outcome)}`}>
                            {alert.outcome || 'PENDING'}
                          </span>
                        </td>
                        <td className={`cell-pl ${plPercent >= 0 ? 'positive' : 'negative'}`}>
                          {formatPL(plPercent, true)}
                        </td>
                        <td className={`cell-pl ${plUSDT >= 0 ? 'positive' : 'negative'}`}>
                          {formatPL(plUSDT)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* Summary row */}
                <tfoot>
                  <tr className="summary-row">
                    <td colSpan="11" className="summary-label">
                      <strong>TOTAL</strong>
                      <span className="summary-stats">
                        {totals.completedTrades} trades | {totals.totalWins}W / {totals.totalLosses}L | WR: {totals.winRate}%
                      </span>
                    </td>
                    <td className="cell-outcome">
                      <span className={`outcome-badge ${totals.totalPLUSDT >= 0 ? 'outcome-win' : 'outcome-loss'}`}>
                        {totals.totalPLUSDT >= 0 ? 'PROFIT' : 'LOSS'}
                      </span>
                    </td>
                    <td className={`cell-pl total ${totals.totalPLPercent >= 0 ? 'positive' : 'negative'}`}>
                      <strong>{formatPL(totals.totalPLPercent, true)}</strong>
                    </td>
                    <td className={`cell-pl total ${totals.totalPLUSDT >= 0 ? 'positive' : 'negative'}`}>
                      <strong>{formatPL(totals.totalPLUSDT)}</strong>
                    </td>
                  </tr>
                </tfoot>
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
