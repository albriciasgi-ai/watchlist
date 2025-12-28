import React, { useState, useEffect } from 'react';

const PerformancePanel = ({ orderManager, currentPrice, currentTime }) => {
  const [balance, setBalance] = useState({});
  const [metrics, setMetrics] = useState({});
  const [openOrders, setOpenOrders] = useState([]);

  /**
   * Actualiza métricas periódicamente
   */
  useEffect(() => {
    if (!orderManager) return;

    const updateMetrics = () => {
      setBalance(orderManager.getBalance());
      setMetrics(orderManager.getMetrics());
      setOpenOrders(orderManager.getOpenOrders());
    };

    // Actualizar inmediatamente
    updateMetrics();

    // Actualizar cada segundo
    const interval = setInterval(updateMetrics, 1000);

    return () => clearInterval(interval);
  }, [orderManager]);

  /**
   * Cierra una orden específica
   */
  const handleCloseOrder = (orderId) => {
    if (!orderManager || !currentPrice || !currentTime) {
      alert('No se puede cerrar la orden: precio o tiempo no disponible');
      return;
    }

    if (confirm('¿Cerrar esta orden?')) {
      orderManager.closeOrder(orderId, currentPrice, currentTime, 'manual');
      // Actualizar inmediatamente
      setOpenOrders(orderManager.getOpenOrders());
      setBalance(orderManager.getBalance());
      setMetrics(orderManager.getMetrics());
    }
  };

  /**
   * Cierra todas las órdenes abiertas
   */
  const handleCloseAllOrders = () => {
    if (!orderManager || !currentPrice || !currentTime) return;

    if (openOrders.length === 0) {
      alert('No hay órdenes abiertas');
      return;
    }

    if (!confirm(`¿Cerrar todas las ${openOrders.length} órdenes abiertas?`)) {
      return;
    }

    openOrders.forEach(order => {
      orderManager.closeOrder(order.id, currentPrice, currentTime, 'manual_close_all');
    });

    // Actualizar inmediatamente
    setOpenOrders(orderManager.getOpenOrders());
    setBalance(orderManager.getBalance());
    setMetrics(orderManager.getMetrics());

    console.log('[PerformancePanel] Todas las órdenes cerradas');
  };

  /**
   * Formatea número con signo y color
   */
  const formatPnL = (value) => {
    const isPositive = value >= 0;
    const sign = isPositive ? '+' : '';
    const color = isPositive ? '#26a69a' : '#ef5350';

    return (
      <span style={{ color, fontWeight: 'bold' }}>
        {sign}{value.toFixed(2)}
      </span>
    );
  };

  /**
   * Exporta resultados a JSON
   */
  const handleExport = () => {
    if (!orderManager) return;

    const data = orderManager.exportToJSON();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtesting_results_${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="performance-panel">
      {/* Balance Section */}
      <div className="panel-section balance-section">
        <h3>Balance</h3>
        <div className="balance-grid">
          <div className="balance-item">
            <span className="label">Inicial:</span>
            <span className="value">${balance.initial?.toFixed(2) || '0.00'}</span>
          </div>
          <div className="balance-item">
            <span className="label">Actual:</span>
            <span className="value">${balance.current?.toFixed(2) || '0.00'}</span>
          </div>
          <div className="balance-item">
            <span className="label">No realizado:</span>
            <span className="value">{formatPnL(balance.unrealizedPnL || 0)}</span>
          </div>
          <div className="balance-item">
            <span className="label">Realizado:</span>
            <span className="value">{formatPnL(balance.realizedPnL || 0)}</span>
          </div>
          <div className="balance-item balance-total">
            <span className="label">Total:</span>
            <span className="value">
              ${balance.total?.toFixed(2) || '0.00'}
              {' '}
              ({formatPnL(balance.totalPercent || 0)}%)
            </span>
          </div>
        </div>
      </div>

      {/* Métricas Section */}
      <div className="panel-section metrics-section">
        <h3>Métricas</h3>
        <div className="metrics-grid">
          <div className="metric-item">
            <span className="metric-label">Total Trades:</span>
            <span className="metric-value">{metrics.totalTrades || 0}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Abiertos:</span>
            <span className="metric-value">{metrics.openTrades || 0}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Ganadores:</span>
            <span className="metric-value" style={{ color: '#26a69a' }}>
              {metrics.winningTrades || 0}
            </span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Perdedores:</span>
            <span className="metric-value" style={{ color: '#ef5350' }}>
              {metrics.losingTrades || 0}
            </span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Win Rate:</span>
            <span className="metric-value">
              {metrics.winRate?.toFixed(1) || '0.0'}%
            </span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Ganancia Avg:</span>
            <span className="metric-value" style={{ color: '#26a69a' }}>
              ${metrics.avgWin?.toFixed(2) || '0.00'}
            </span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Pérdida Avg:</span>
            <span className="metric-value" style={{ color: '#ef5350' }}>
              ${metrics.avgLoss?.toFixed(2) || '0.00'}
            </span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Profit Factor:</span>
            <span className="metric-value">
              {metrics.profitFactor?.toFixed(2) || '0.00'}
            </span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Max Drawdown:</span>
            <span className="metric-value" style={{ color: '#ef5350' }}>
              {metrics.maxDrawdown?.toFixed(2) || '0.00'}%
            </span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Mayor Ganancia:</span>
            <span className="metric-value" style={{ color: '#26a69a' }}>
              ${metrics.largestWin?.toFixed(2) || '0.00'}
            </span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Mayor Pérdida:</span>
            <span className="metric-value" style={{ color: '#ef5350' }}>
              ${metrics.largestLoss?.toFixed(2) || '0.00'}
            </span>
          </div>
        </div>
      </div>

      {/* Órdenes Abiertas Section */}
      <div className="panel-section open-orders-section">
        <h3>Órdenes Abiertas ({openOrders.length})</h3>
        {openOrders.length === 0 ? (
          <div className="no-orders">No hay órdenes abiertas</div>
        ) : (
          <>
            <div className="orders-list">
              {openOrders.map(order => (
                <div key={order.id} className={`order-item ${order.side}`}>
                  <div className="order-header">
                    <span className="order-id">#{order.id}</span>
                    <span className={`order-side-badge ${order.side}`}>
                      {order.side === 'long' ? '📈 LONG' : '📉 SHORT'}
                    </span>
                    <button
                      className="btn-close-order"
                      onClick={() => handleCloseOrder(order.id)}
                      title="Cerrar esta orden"
                      style={{
                        marginLeft: 'auto',
                        padding: '4px 8px',
                        fontSize: '11px',
                        backgroundColor: '#ef5350',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer'
                      }}
                    >
                      ✕ Cerrar
                    </button>
                  </div>
                  <div className="order-details">
                    <div className="order-detail-row">
                      <span>Entrada:</span>
                      <span>${order.entryPrice.toFixed(2)}</span>
                    </div>
                    <div className="order-detail-row">
                      <span>Cantidad:</span>
                      <span>{order.quantity}</span>
                    </div>
                    {order.stopLoss && (
                      <div className="order-detail-row">
                        <span>SL:</span>
                        <span>${order.stopLoss.toFixed(2)}</span>
                      </div>
                    )}
                    {order.takeProfit && (
                      <div className="order-detail-row">
                        <span>TP:</span>
                        <span>${order.takeProfit.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="order-detail-row order-pnl">
                      <span>P&L:</span>
                      <span>{formatPnL(order.currentPnl || 0)}</span>
                    </div>
                    <div className="order-detail-row">
                      <span>P&L %:</span>
                      <span>{formatPnL(order.currentPnlPercent || 0)}%</span>
                    </div>
                  </div>
                  {order.notes && (
                    <div className="order-notes">
                      📝 {order.notes}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Botón Cerrar Todas debajo de la lista */}
            <div style={{ marginTop: '12px' }}>
              <button
                className="btn-close-all"
                onClick={handleCloseAllOrders}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: '#ef5350',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '13px'
                }}
              >
                ❌ Cerrar Todas las Órdenes
              </button>
            </div>
          </>
        )}
      </div>

      {/* Export Button */}
      <div className="panel-section export-section">
        <button className="btn-export" onClick={handleExport}>
          📥 Exportar Resultados
        </button>
      </div>
    </div>
  );
};

export default PerformancePanel;
