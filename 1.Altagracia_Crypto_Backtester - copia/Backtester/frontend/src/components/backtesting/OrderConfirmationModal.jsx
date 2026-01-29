import React, { useState, useEffect } from 'react';
import './OrderConfirmationModal.css';

/**
 * Modal de confirmación cuando se crea una orden
 * Muestra detalles completos y se cierra automáticamente después de 5 segundos
 */
const OrderConfirmationModal = ({ order, currentPrice, onClose }) => {
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          onClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onClose]);

  /**
   * Calcula métricas de la orden (R:R, riesgo, etc.)
   */
  const calculateMetrics = () => {
    // 🎯 Usar el precio ejecutado real si existe (para limit orders), sino usar entryPrice
    const entry = order.executedPrice || order.entryPrice;
    const sl = order.stopLoss;
    const tp = order.takeProfit;

    if (!sl || !tp) return null;

    const slDistance = Math.abs(entry - sl);
    const tpDistance = Math.abs(tp - entry);
    const riskReward = (tpDistance / slDistance).toFixed(2);
    const riskAmount = (slDistance * order.quantity).toFixed(2);

    // Calcular porcentajes según el lado de la operación
    let slPercent, tpPercent;

    if (order.side === 'long') {
      slPercent = (((sl - entry) / entry) * 100).toFixed(2);
      tpPercent = (((tp - entry) / entry) * 100).toFixed(2);
    } else {
      slPercent = (((entry - sl) / entry) * 100).toFixed(2);
      tpPercent = (((entry - tp) / entry) * 100).toFixed(2);
    }

    return { riskReward, riskAmount, slPercent, tpPercent };
  };

  const metrics = calculateMetrics();

  return (
    <div className="order-modal-overlay" onClick={onClose}>
      <div className="order-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h3>✅ Orden Creada Exitosamente</h3>
          <button className="order-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="order-modal-body">
          <div className="order-detail">
            <span className="order-label">Tipo:</span>
            <span className="order-value order-type">{order.type.toUpperCase()}</span>
          </div>

          <div className="order-detail">
            <span className="order-label">Lado:</span>
            <span className={`order-value order-side-${order.side}`}>
              {order.side.toUpperCase()} {order.side === 'long' ? '📈' : '📉'}
            </span>
          </div>

          <div className="order-detail">
            <span className="order-label">Cantidad:</span>
            <span className="order-value">{order.quantity}</span>
          </div>

          <div className="order-detail order-detail-highlight">
            <span className="order-label">Precio {order.executedPrice ? 'Ejecutado' : 'Entrada'}:</span>
            <span className="order-value order-price">${(order.executedPrice || order.entryPrice).toFixed(2)}</span>
          </div>

          {order.type !== 'market' && order.executedPrice && order.entryPrice !== order.executedPrice && (
            <div className="order-detail">
              <span className="order-label">Precio Objetivo:</span>
              <span className="order-value">${order.entryPrice.toFixed(2)}</span>
            </div>
          )}

          {order.stopLoss && (
            <div className="order-detail">
              <span className="order-label">Stop Loss:</span>
              <span className="order-value order-sl">
                ${order.stopLoss.toFixed(2)}
                {metrics && <span className="order-percent">({metrics.slPercent}%)</span>}
              </span>
            </div>
          )}

          {order.takeProfit && (
            <div className="order-detail">
              <span className="order-label">Take Profit:</span>
              <span className="order-value order-tp">
                ${order.takeProfit.toFixed(2)}
                {metrics && <span className="order-percent">(+{metrics.tpPercent}%)</span>}
              </span>
            </div>
          )}

          {metrics && (
            <>
              <div className="order-detail order-detail-highlight">
                <span className="order-label">Risk/Reward:</span>
                <span className="order-value order-rr">1:{metrics.riskReward}</span>
              </div>
              <div className="order-detail order-detail-highlight">
                <span className="order-label">Riesgo Total:</span>
                <span className="order-value order-risk">${metrics.riskAmount}</span>
              </div>
            </>
          )}

          {order.notes && (
            <div className="order-notes">
              <div className="order-notes-label">Notas:</div>
              <div className="order-notes-content">"{order.notes}"</div>
            </div>
          )}
        </div>

        <div className="order-modal-footer">
          <button className="order-modal-btn-close" onClick={onClose}>
            Cerrar ({countdown}s)
          </button>
        </div>
      </div>
    </div>
  );
};

export default OrderConfirmationModal;
