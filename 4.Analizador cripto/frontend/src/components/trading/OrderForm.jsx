// src/components/trading/OrderForm.jsx
// Formulario de orden con modos de cantidad fija y por riesgo
import React, { useState, useEffect, useCallback, useMemo } from 'react';

const OrderForm = ({
  symbol,
  symbolConfig,
  tpslBoxData,  // { entryPrice, slPrice, tpPrice, side: 'Buy'|'Sell' }
  currentPrice,
  onSubmit,
  orderStatus,
  disabled
}) => {
  // Estado del formulario
  const [side, setSide] = useState('Buy');
  const [quantityMode, setQuantityMode] = useState('fixed'); // 'fixed' | 'risk'
  const [fixedAmount, setFixedAmount] = useState('100'); // USDT
  const [riskAmount, setRiskAmount] = useState('10'); // USDT a arriesgar

  // Modal de confirmación
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [pendingOrder, setPendingOrder] = useState(null);

  // Actualizar side cuando cambia el TPSLBox
  useEffect(() => {
    if (tpslBoxData?.side) {
      setSide(tpslBoxData.side);
    }
  }, [tpslBoxData?.side]);

  // Calcular % de SL respecto al entry
  const slPercent = useMemo(() => {
    if (!tpslBoxData) return 0;
    const { entryPrice, slPrice } = tpslBoxData;
    if (!entryPrice || !slPrice) return 0;
    return Math.abs((slPrice - entryPrice) / entryPrice);
  }, [tpslBoxData]);

  // Calcular % de TP respecto al entry
  const tpPercent = useMemo(() => {
    if (!tpslBoxData) return 0;
    const { entryPrice, tpPrice } = tpslBoxData;
    if (!entryPrice || !tpPrice) return 0;
    return Math.abs((tpPrice - entryPrice) / entryPrice);
  }, [tpslBoxData]);

  // Calcular cantidad basada en el modo
  const calculatedQuantity = useMemo(() => {
    if (!tpslBoxData || !symbolConfig) return { qty: 0, investment: 0 };

    const entryPrice = tpslBoxData.entryPrice || currentPrice;
    if (!entryPrice) return { qty: 0, investment: 0 };

    let investment;

    if (quantityMode === 'fixed') {
      investment = parseFloat(fixedAmount) || 0;
    } else {
      // Modo riesgo: Investment = RiskAmount / SL%
      const risk = parseFloat(riskAmount) || 0;
      if (slPercent <= 0) {
        investment = 0;
      } else {
        investment = risk / slPercent;
      }
    }

    // Calcular cantidad cruda
    let qty = investment / entryPrice;

    // Aplicar StepSize
    const stepSize = parseFloat(symbolConfig.stepSize) || 0.001;
    qty = Math.floor(qty / stepSize) * stepSize;

    // Redondear a la precisión correcta
    const decimals = stepSize.toString().split('.')[1]?.length || 0;
    qty = parseFloat(qty.toFixed(decimals));

    return {
      qty,
      investment: qty * entryPrice
    };
  }, [tpslBoxData, symbolConfig, currentPrice, quantityMode, fixedAmount, riskAmount, slPercent]);

  // Calcular ganancia potencial y pérdida potencial
  const potentialPnL = useMemo(() => {
    if (!tpslBoxData || calculatedQuantity.qty <= 0) {
      return { profit: 0, loss: 0 };
    }

    const { entryPrice, slPrice, tpPrice } = tpslBoxData;
    const qty = calculatedQuantity.qty;

    // Para LONG: profit si sube a TP, loss si baja a SL
    // Para SHORT: profit si baja a TP, loss si sube a SL
    const profit = Math.abs(tpPrice - entryPrice) * qty;
    const loss = Math.abs(entryPrice - slPrice) * qty;

    return { profit, loss };
  }, [tpslBoxData, calculatedQuantity]);

  // Risk/Reward ratio
  const riskRewardRatio = useMemo(() => {
    if (potentialPnL.loss === 0) return '∞';
    const ratio = potentialPnL.profit / potentialPnL.loss;
    return `1:${ratio.toFixed(2)}`;
  }, [potentialPnL]);

  // Handler para preparar orden
  const handlePrepareOrder = useCallback(() => {
    if (!tpslBoxData || calculatedQuantity.qty <= 0) return;

    const order = {
      side,
      quantity: calculatedQuantity.qty,
      stopLoss: tpslBoxData.slPrice,
      takeProfit: tpslBoxData.tpPrice,
      entryPrice: tpslBoxData.entryPrice,
      investment: calculatedQuantity.investment,
      potentialProfit: potentialPnL.profit,
      potentialLoss: potentialPnL.loss
    };

    setPendingOrder(order);
    setShowConfirmation(true);
  }, [side, tpslBoxData, calculatedQuantity, potentialPnL]);

  // Handler para confirmar orden
  const handleConfirmOrder = useCallback(() => {
    if (pendingOrder) {
      onSubmit(pendingOrder);
      setShowConfirmation(false);
      setPendingOrder(null);
    }
  }, [pendingOrder, onSubmit]);

  // Handler para cancelar
  const handleCancelOrder = useCallback(() => {
    setShowConfirmation(false);
    setPendingOrder(null);
  }, []);

  // Formatear precio según tickSize
  const formatPrice = (price) => {
    if (!price) return '--';
    const tickSize = parseFloat(symbolConfig?.tickSize) || 0.01;
    const decimals = tickSize.toString().split('.')[1]?.length || 2;
    return price.toFixed(decimals);
  };

  // Si no hay TPSLBox, mostrar mensaje
  if (!tpslBoxData) {
    return (
      <div className="order-form">
        <div className="no-tpsl-warning">
          <div className="icon">📦</div>
          <p>
            <strong>Dibuja una caja TP/SL</strong>
            Usa la herramienta de dibujo para definir Entry, Stop Loss y Take Profit.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="order-form">
        {/* Precios del TPSLBox */}
        <div className="order-form-section">
          <h4>Precios de la Orden</h4>
          <div className="price-display">
            <div className="price-item entry">
              <div className="price-label">Entry</div>
              <div className="price-value">{formatPrice(tpslBoxData.entryPrice)}</div>
            </div>
            <div className="price-item sl">
              <div className="price-label">Stop Loss</div>
              <div className="price-value">{formatPrice(tpslBoxData.slPrice)}</div>
              <div className="price-percent negative">-{(slPercent * 100).toFixed(2)}%</div>
            </div>
            <div className="price-item tp">
              <div className="price-label">Take Profit</div>
              <div className="price-value">{formatPrice(tpslBoxData.tpPrice)}</div>
              <div className="price-percent positive">+{(tpPercent * 100).toFixed(2)}%</div>
            </div>
          </div>
        </div>

        {/* Dirección */}
        <div className="order-form-section">
          <h4>Direccion</h4>
          <div className="side-toggle">
            <button
              className={`side-btn buy ${side === 'Buy' ? 'active' : ''}`}
              onClick={() => setSide('Buy')}
            >
              📈 LONG (Buy)
            </button>
            <button
              className={`side-btn sell ${side === 'Sell' ? 'active' : ''}`}
              onClick={() => setSide('Sell')}
            >
              📉 SHORT (Sell)
            </button>
          </div>
        </div>

        {/* Cantidad */}
        <div className="order-form-section">
          <h4>Cantidad</h4>
          <div className="quantity-mode-toggle">
            <button
              className={`mode-btn ${quantityMode === 'fixed' ? 'active' : ''}`}
              onClick={() => setQuantityMode('fixed')}
            >
              Monto Fijo
            </button>
            <button
              className={`mode-btn ${quantityMode === 'risk' ? 'active' : ''}`}
              onClick={() => setQuantityMode('risk')}
            >
              Por Riesgo
            </button>
          </div>

          {quantityMode === 'fixed' ? (
            <div className="input-row">
              <label>Inversion:</label>
              <input
                type="number"
                value={fixedAmount}
                onChange={(e) => setFixedAmount(e.target.value)}
                min="1"
                step="10"
              />
              <span className="input-suffix">USDT</span>
            </div>
          ) : (
            <div className="input-row">
              <label>Riesgo:</label>
              <input
                type="number"
                value={riskAmount}
                onChange={(e) => setRiskAmount(e.target.value)}
                min="1"
                step="1"
              />
              <span className="input-suffix">USDT</span>
            </div>
          )}

          {/* Info calculada */}
          <div className="calculated-info">
            <div className="calc-row">
              <span className="label">Cantidad:</span>
              <span className="value">{calculatedQuantity.qty.toFixed(6)} {symbol.replace('USDT', '')}</span>
            </div>
            <div className="calc-row">
              <span className="label">Inversion Total:</span>
              <span className="value highlight">${calculatedQuantity.investment.toFixed(2)} USDT</span>
            </div>
            <div className="calc-row">
              <span className="label">Ganancia Potencial:</span>
              <span className="value" style={{ color: '#10b981' }}>+${potentialPnL.profit.toFixed(2)}</span>
            </div>
            <div className="calc-row">
              <span className="label">Perdida Potencial:</span>
              <span className="value" style={{ color: '#ef4444' }}>-${potentialPnL.loss.toFixed(2)}</span>
            </div>
            <div className="calc-row">
              <span className="label">Risk/Reward:</span>
              <span className="value">{riskRewardRatio}</span>
            </div>
          </div>
        </div>

        {/* Botón de submit */}
        <div className="order-submit-section">
          <button
            className={`submit-btn ${side.toLowerCase()}`}
            onClick={handlePrepareOrder}
            disabled={disabled || calculatedQuantity.qty <= 0}
          >
            {orderStatus.loading ? (
              <>
                <span className="spinner"></span>
                Ejecutando...
              </>
            ) : (
              <>
                {side === 'Buy' ? '📈 Abrir LONG' : '📉 Abrir SHORT'}
              </>
            )}
          </button>

          {/* Status de orden */}
          {orderStatus.success && (
            <div className="order-status success">
              ✅ Orden ejecutada exitosamente
            </div>
          )}
          {orderStatus.error && (
            <div className="order-status error">
              ❌ {orderStatus.error}
            </div>
          )}
        </div>
      </div>

      {/* Modal de confirmación */}
      {showConfirmation && pendingOrder && (
        <div className="confirmation-overlay" onClick={handleCancelOrder}>
          <div className="confirmation-modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              {side === 'Buy' ? '📈' : '📉'} Confirmar Orden
            </h3>
            <div className="confirmation-details">
              <div className="confirmation-row">
                <span className="label">Simbolo:</span>
                <span className="value">{symbol}</span>
              </div>
              <div className="confirmation-row">
                <span className="label">Direccion:</span>
                <span className="value" style={{ color: side === 'Buy' ? '#10b981' : '#ef4444' }}>
                  {side === 'Buy' ? 'LONG' : 'SHORT'}
                </span>
              </div>
              <div className="confirmation-row">
                <span className="label">Tipo:</span>
                <span className="value">MARKET</span>
              </div>
              <div className="confirmation-row">
                <span className="label">Cantidad:</span>
                <span className="value">{pendingOrder.quantity.toFixed(6)}</span>
              </div>
              <div className="confirmation-row">
                <span className="label">Entry (aprox):</span>
                <span className="value">${formatPrice(pendingOrder.entryPrice)}</span>
              </div>
              <div className="confirmation-row">
                <span className="label">Stop Loss:</span>
                <span className="value" style={{ color: '#ef4444' }}>${formatPrice(pendingOrder.stopLoss)}</span>
              </div>
              <div className="confirmation-row">
                <span className="label">Take Profit:</span>
                <span className="value" style={{ color: '#10b981' }}>${formatPrice(pendingOrder.takeProfit)}</span>
              </div>
              <div className="confirmation-row">
                <span className="label">Inversion:</span>
                <span className="value">${pendingOrder.investment.toFixed(2)} USDT</span>
              </div>
            </div>
            <div className="confirmation-buttons">
              <button className="cancel-btn" onClick={handleCancelOrder}>
                Cancelar
              </button>
              <button
                className={`confirm-btn ${side.toLowerCase()}`}
                onClick={handleConfirmOrder}
              >
                Confirmar Orden
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default OrderForm;
