import React, { useState, useMemo, useEffect } from 'react';
import { useGlobalAlerts } from '../../hooks/useGlobalAlerts';

const RISK_AMOUNT_KEY = 'watchlist_risk_amount';
const TIME_FILTER_KEY = 'watchlist_alerts_time_filter';

// Opciones de filtro de tiempo en horas
const TIME_FILTER_OPTIONS = [
  { value: 1, label: '1 hora' },
  { value: 6, label: '6 horas' },
  { value: 12, label: '12 horas' },
  { value: 24, label: '24 horas' },
  { value: 48, label: '2 días' },
  { value: 168, label: '7 días' },
  { value: 0, label: 'Todo' }
];

/**
 * Tab de Alertas en Tiempo Real
 * Muestra alertas enviadas con filtro de tiempo configurable
 */
const RealTimeAlertsTab = ({ isOpen }) => {
  const { alerts, isLoading, isEvaluating, clearAlerts, exportToCSV, evaluatePendingOutcomes } = useGlobalAlerts();
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [riskAmount, setRiskAmount] = useState(() => {
    const stored = localStorage.getItem(RISK_AMOUNT_KEY);
    return stored ? parseFloat(stored) : 100;
  });
  const [timeFilterHours, setTimeFilterHours] = useState(() => {
    const stored = localStorage.getItem(TIME_FILTER_KEY);
    return stored ? parseInt(stored) : 24;
  });

  // Guardar configuraciones en localStorage
  useEffect(() => {
    localStorage.setItem(RISK_AMOUNT_KEY, riskAmount.toString());
  }, [riskAmount]);

  useEffect(() => {
    localStorage.setItem(TIME_FILTER_KEY, timeFilterHours.toString());
  }, [timeFilterHours]);

  // Evaluar cuando se abre el panel
  useEffect(() => {
    if (isOpen) {
      evaluatePendingOutcomes();
    }
  }, [isOpen, evaluatePendingOutcomes]);

  // Filtrar alertas por tiempo
  const filteredAlerts = useMemo(() => {
    if (timeFilterHours === 0) return alerts; // "Todo"

    const cutoffTime = Date.now() - (timeFilterHours * 60 * 60 * 1000);
    return alerts.filter(alert => alert.timestamp >= cutoffTime);
  }, [alerts, timeFilterHours]);

  const handleClearClick = () => setShowConfirmClear(true);
  const handleConfirmClear = () => {
    clearAlerts();
    setShowConfirmClear(false);
  };
  const handleCancelClear = () => setShowConfirmClear(false);
  const handleRiskChange = (e) => setRiskAmount(parseFloat(e.target.value) || 0);
  const handleTimeFilterChange = (e) => setTimeFilterHours(parseInt(e.target.value));

  // Funciones de formato
  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  };

  const formatPrice = (value) => {
    if (value === null || value === undefined) return '-';
    return `$${value.toFixed(2)}`;
  };

  const formatPercent = (value) => {
    if (value === null || value === undefined) return '-';
    return `${value.toFixed(2)}%`;
  };

  const formatPL = (value, isPercent = false) => {
    if (value === null || value === undefined) return '-';
    const sign = value >= 0 ? '+' : '';
    return isPercent ? `${sign}${value.toFixed(2)}%` : `${sign}$${value.toFixed(2)}`;
  };

  const getDirectionClass = (direction) => {
    if (direction === 'LONG') return 'direction-long';
    if (direction === 'SHORT') return 'direction-short';
    return '';
  };

  const getOutcomeClass = (outcome) => {
    if (outcome === 'WIN') return 'outcome-win';
    if (outcome === 'LOSS') return 'outcome-loss';
    return 'outcome-pending';
  };

  // Calcular P/L para cada alerta
  const calculatePL = (alert) => {
    if (!alert.outcome || alert.outcome === 'PENDING') {
      return { plPercent: null, plUSDT: null };
    }
    const slPercent = Math.abs(alert.slPercent || 0);
    const tpPercent = Math.abs(alert.tpPercent || 0);
    const rr = slPercent > 0 ? tpPercent / slPercent : 0;

    if (alert.outcome === 'WIN') {
      return { plPercent: tpPercent, plUSDT: riskAmount * rr };
    } else if (alert.outcome === 'LOSS') {
      return { plPercent: -slPercent, plUSDT: -riskAmount };
    }
    return { plPercent: null, plUSDT: null };
  };

  // Calcular totales
  const totals = useMemo(() => {
    let totalWins = 0, totalLosses = 0, totalPLPercent = 0, totalPLUSDT = 0, completedTrades = 0;

    filteredAlerts.forEach(alert => {
      if (alert.outcome === 'WIN') { totalWins++; completedTrades++; }
      else if (alert.outcome === 'LOSS') { totalLosses++; completedTrades++; }

      const { plPercent, plUSDT } = calculatePL(alert);
      if (plPercent !== null) totalPLPercent += plPercent;
      if (plUSDT !== null) totalPLUSDT += plUSDT;
    });

    const winRate = completedTrades > 0 ? (totalWins / completedTrades * 100).toFixed(1) : 0;
    return { totalWins, totalLosses, completedTrades, winRate, totalPLPercent, totalPLUSDT };
  }, [filteredAlerts, riskAmount]);

  const alertCount = filteredAlerts.length;

  return (
    <>
      {/* Toolbar */}
      <div className="panel-toolbar">
        <div className="toolbar-left">
          <div className="risk-input-container">
            <label>Riesgo:</label>
            <div className="risk-input-wrapper">
              <span className="currency-symbol">$</span>
              <input
                type="number"
                value={riskAmount}
                onChange={handleRiskChange}
                min="0"
                step="10"
                className="risk-input"
              />
            </div>
          </div>
          <div className="time-filter-container">
            <label>Periodo:</label>
            <select
              value={timeFilterHours}
              onChange={handleTimeFilterChange}
              className="time-filter-select"
            >
              {TIME_FILTER_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="toolbar-buttons">
          <button
            className={`toolbar-btn refresh-btn ${isEvaluating ? 'evaluating' : ''}`}
            onClick={evaluatePendingOutcomes}
            disabled={isEvaluating || alertCount === 0}
            title="Actualizar resultados"
          >
            {isEvaluating ? '⏳' : '🔄'}
          </button>
          <button
            className="toolbar-btn export-btn"
            onClick={() => exportToCSV(riskAmount)}
            disabled={alertCount === 0}
            title="Exportar CSV"
          >
            📥
          </button>
          <button
            className="toolbar-btn clear-btn"
            onClick={handleClearClick}
            disabled={alertCount === 0}
            title="Limpiar"
          >
            🗑️
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
            <p>No hay alertas en este periodo</p>
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
                {filteredAlerts.map((alert, index) => {
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

      {/* Footer */}
      <div className="panel-footer">
        <span className="footer-info">
          {alertCount} alertas • Auto-actualización cada 3s
        </span>
      </div>
    </>
  );
};

export default RealTimeAlertsTab;
