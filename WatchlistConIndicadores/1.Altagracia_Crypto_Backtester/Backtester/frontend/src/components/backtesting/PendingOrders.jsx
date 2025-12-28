import React from 'react';
import './PendingOrders.css';

/**
 * Componente para mostrar órdenes pendientes (limit/stop)
 * Permite ver detalles y cancelar órdenes
 */
const PendingOrders = ({ orderManager, currentPrice }) => {
  if (!orderManager) return null;

  const pendingOrders = orderManager.getPendingOrders();

  const handleCancelOrder = (orderId) => {
    if (window.confirm('¿Cancelar esta orden pendiente?')) {
      orderManager.cancelPendingOrder(orderId);
      console.log('[PendingOrders] Orden cancelada:', orderId);
    }
  };

  /**
   * Calcula la distancia entre el precio actual y el precio objetivo
   */
  const getPriceDistance = (order) => {
    if (!currentPrice) return null;

    const distance = order.entryPrice - currentPrice;
    const percent = (Math.abs(distance) / currentPrice) * 100;
    const direction = distance > 0 ? 'arriba' : 'abajo';

    return {
      distance: Math.abs(distance).toFixed(2),
      percent: percent.toFixed(2),
      direction
    };
  };

  if (pendingOrders.length === 0) {
    return (
      <div className="pending-orders">
        <h4>Órdenes Pendientes</h4>
        <div className="pending-empty">
          No hay órdenes pendientes
        </div>
      </div>
    );
  }

  return (
    <div className="pending-orders">
      <h4>
        Órdenes Pendientes
        <span className="pending-count">{pendingOrders.length}</span>
      </h4>

      <div className="pending-list">
        {pendingOrders.map(order => {
          const priceInfo = getPriceDistance(order);

          return (
            <div key={order.id} className={`pending-item pending-${order.side}`}>
              <div className="pending-header">
                <span className={`pending-side pending-side-${order.side}`}>
                  {order.side.toUpperCase()} {order.side === 'long' ? '📈' : '📉'}
                </span>
                <span className="pending-type">{order.type.toUpperCase()}</span>
              </div>

              <div className="pending-details">
                <div className="pending-detail">
                  <span className="pending-label">Precio Objetivo:</span>
                  <span className="pending-value pending-price">
                    ${order.entryPrice.toFixed(2)}
                  </span>
                </div>

                {priceInfo && (
                  <div className="pending-detail">
                    <span className="pending-label">Distancia:</span>
                    <span className="pending-value">
                      ${priceInfo.distance} ({priceInfo.percent}% {priceInfo.direction})
                    </span>
                  </div>
                )}

                <div className="pending-detail">
                  <span className="pending-label">Cantidad:</span>
                  <span className="pending-value">{order.quantity}</span>
                </div>

                {order.stopLoss && (
                  <div className="pending-detail">
                    <span className="pending-label">SL:</span>
                    <span className="pending-value pending-sl">
                      ${order.stopLoss.toFixed(2)}
                    </span>
                  </div>
                )}

                {order.takeProfit && (
                  <div className="pending-detail">
                    <span className="pending-label">TP:</span>
                    <span className="pending-value pending-tp">
                      ${order.takeProfit.toFixed(2)}
                    </span>
                  </div>
                )}

                {order.notes && (
                  <div className="pending-notes">
                    "{order.notes}"
                  </div>
                )}
              </div>

              <div className="pending-actions">
                <button
                  className="btn-cancel-order"
                  onClick={() => handleCancelOrder(order.id)}
                  title="Cancelar orden"
                >
                  ❌ Cancelar
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PendingOrders;
