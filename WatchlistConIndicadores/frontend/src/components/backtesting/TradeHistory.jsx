import React, { useState, useEffect } from 'react';

const TradeHistory = ({ orderManager }) => {
  const [closedOrders, setClosedOrders] = useState([]);
  const [filterSide, setFilterSide] = useState('all'); // 'all', 'long', 'short'
  const [filterResult, setFilterResult] = useState('all'); // 'all', 'win', 'loss'

  /**
   * Actualiza historial periódicamente
   */
  useEffect(() => {
    if (!orderManager) return;

    const updateHistory = () => {
      setClosedOrders(orderManager.getClosedOrders());
    };

    // Actualizar inmediatamente
    updateHistory();

    // Actualizar cada 2 segundos
    const interval = setInterval(updateHistory, 2000);

    return () => clearInterval(interval);
  }, [orderManager]);

  /**
   * Filtra órdenes según criterios
   */
  const getFilteredOrders = () => {
    let filtered = [...closedOrders];

    // Filtrar por lado
    if (filterSide !== 'all') {
      filtered = filtered.filter(o => o.side === filterSide);
    }

    // Filtrar por resultado
    if (filterResult === 'win') {
      filtered = filtered.filter(o => o.pnl > 0);
    } else if (filterResult === 'loss') {
      filtered = filtered.filter(o => o.pnl <= 0);
    }

    // Ordenar por fecha de cierre (más reciente primero)
    filtered.sort((a, b) => b.exitTime - a.exitTime);

    return filtered;
  };

  /**
   * Formatea timestamp a fecha legible
   */
  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  /**
   * Formatea duración del trade
   */
  const formatDuration = (entryTime, exitTime) => {
    const durationMs = exitTime - entryTime;
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${days}d ${remainingHours}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  };

  /**
   * Formatea PnL con color
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
   * Obtiene emoji según razón de cierre
   */
  const getCloseReasonEmoji = (reason) => {
    switch (reason) {
      case 'take_profit':
        return '🎯';
      case 'stop_loss':
        return '🛑';
      case 'manual':
      case 'manual_close_all':
        return '✋';
      default:
        return '❓';
    }
  };

  const filteredOrders = getFilteredOrders();

  return (
    <div className="trade-history">
      <div className="history-header">
        <h3>Historial de Trades ({closedOrders.length})</h3>

        <div className="history-filters">
          <select value={filterSide} onChange={(e) => setFilterSide(e.target.value)}>
            <option value="all">Todos los lados</option>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>

          <select value={filterResult} onChange={(e) => setFilterResult(e.target.value)}>
            <option value="all">Todos los resultados</option>
            <option value="win">Ganadores</option>
            <option value="loss">Perdedores</option>
          </select>
        </div>
      </div>

      {filteredOrders.length === 0 ? (
        <div className="no-trades">
          {closedOrders.length === 0
            ? 'No hay trades cerrados aún'
            : 'No hay trades que coincidan con los filtros'
          }
        </div>
      ) : (
        <div className="trades-table-container">
          <table className="trades-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Lado</th>
                <th>Entrada</th>
                <th>Salida</th>
                <th>Cantidad</th>
                <th>PnL</th>
                <th>PnL %</th>
                <th>Duración</th>
                <th>Cierre</th>
                <th>Notas</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map(order => (
                <tr key={order.id} className={order.pnl > 0 ? 'trade-win' : 'trade-loss'}>
                  <td>#{order.id}</td>
                  <td>
                    <span className={`badge-side ${order.side}`}>
                      {order.side === 'long' ? '📈' : '📉'} {order.side.toUpperCase()}
                    </span>
                  </td>
                  <td>${order.entryPrice.toFixed(2)}</td>
                  <td>${order.exitPrice.toFixed(2)}</td>
                  <td>{order.quantity}</td>
                  <td>{formatPnL(order.pnl)}</td>
                  <td>{formatPnL(order.pnlPercent)}%</td>
                  <td>{formatDuration(order.entryTime, order.exitTime)}</td>
                  <td>
                    <span title={order.closeReason}>
                      {getCloseReasonEmoji(order.closeReason)}
                    </span>
                  </td>
                  <td className="trade-notes">
                    {order.notes && (
                      <span title={order.notes}>
                        📝
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default TradeHistory;
