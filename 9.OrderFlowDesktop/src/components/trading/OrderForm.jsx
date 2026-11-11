// src/components/trading/OrderForm.jsx
// Formulario de orden con modos de cantidad fija y por riesgo
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { priceDecimals } from '../../utils/priceFormat';

// Precio con los decimales del tick de la moneda.
// El bot entrega tick_size (snake_case): con "tickSize" siempre caia en 0.01 y GALA salia como $0.02
const fmtPrice = (price, symbolConfig) => {
  if (price === null || price === undefined || !Number.isFinite(Number(price))) return '--';
  const tick = parseFloat(symbolConfig?.tick_size ?? symbolConfig?.tickSize);
  let decimals;
  if (tick > 0) {
    const text = String(tick);
    if (text.includes('e-')) {
      const [mantissa, exponent] = text.split('e-');
      decimals = (mantissa.split('.')[1]?.length || 0) + parseInt(exponent, 10);
    } else {
      decimals = text.split('.')[1]?.length || 0;
    }
  } else {
    decimals = priceDecimals(price);
  }
  return Number(price).toFixed(decimals);
};

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
  const [orderTypeMode, setOrderTypeMode] = useState('auto'); // 'auto' | 'market' | 'limit'

  // Modal de confirmación
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [pendingOrder, setPendingOrder] = useState(null);

  // Actualizar side cuando cambia el TPSLBox
  useEffect(() => {
    if (tpslBoxData?.side) {
      setSide(tpslBoxData.side);
    }
  }, [tpslBoxData?.side]);

  // Si la caja TP/SL o la moneda cambian con la confirmación abierta, se cancela:
  // la orden debe confirmarse con los precios que se van a enviar
  useEffect(() => {
    setShowConfirmation(false);
    setPendingOrder(null);
  }, [tpslBoxData, symbol]);

  // Tipo de orden, precio con que se ejecuta y motivo de bloqueo.
  // - Auto: MARKET si la entrada esta a 0.1% o menos del precio; si no, LIMIT.
  // - Una LIMIT de compra por encima del precio (o de venta por debajo) Bybit la llena al
  //   instante: antes salia igual y la confirmacion decia que esperaria a la entrada.
  // - SL y TP deben quedar del lado correcto del precio de ejecucion; el bot cambiaba en
  //   silencio un SL equivocado por su porcentaje por defecto.
  const orderPlan = useMemo(() => {
    if (!tpslBoxData) return { type: 'MARKET', refPrice: null, block: null };
    const entry = tpslBoxData.entryPrice;
    const price = currentPrice;
    const isBuy = side === 'Buy';

    let type;
    if (orderTypeMode === 'market') type = 'MARKET';
    else if (orderTypeMode === 'limit') type = 'LIMIT';
    else if (!price || Math.abs(entry - price) <= price * 0.001) type = 'MARKET';
    else type = 'LIMIT';

    let block = null;
    if (type === 'LIMIT' && price) {
      const marketable = isBuy ? entry >= price : entry <= price;
      if (marketable) {
        block = isBuy
          ? `La entrada (${fmtPrice(entry, symbolConfig)}) está por encima del precio actual (${fmtPrice(price, symbolConfig)}): una Limit de compra se llenaría al instante, no al llegar a la entrada. Elige Market para entrar ya.`
          : `La entrada (${fmtPrice(entry, symbolConfig)}) está por debajo del precio actual (${fmtPrice(price, symbolConfig)}): una Limit de venta se llenaría al instante, no al llegar a la entrada. Elige Market para entrar ya.`;
      }
    }

    // Precio de ejecucion: el de mercado para MARKET, la entrada para LIMIT
    const refPrice = type === 'MARKET' ? (price || entry) : entry;
    if (!block && refPrice) {
      const { slPrice, tpPrice } = tpslBoxData;
      const slOk = isBuy ? slPrice < refPrice : slPrice > refPrice;
      const tpOk = isBuy ? tpPrice > refPrice : tpPrice < refPrice;
      if (!slOk || !tpOk) {
        block = `${!slOk ? 'El Stop Loss' : 'El Take Profit'} queda del lado equivocado para un ${isBuy ? 'LONG' : 'SHORT'} que entra en ${fmtPrice(refPrice, symbolConfig)}. Revisa la caja o la dirección.`;
      }
    }

    return { type, refPrice, block };
  }, [tpslBoxData, currentPrice, orderTypeMode, side, symbolConfig]);

  // Calcular % de SL respecto al precio de ejecución
  const slPercent = useMemo(() => {
    if (!tpslBoxData) return 0;
    const ref = orderPlan.refPrice;
    const { slPrice } = tpslBoxData;
    if (!ref || !slPrice) return 0;
    return Math.abs((slPrice - ref) / ref);
  }, [tpslBoxData, orderPlan.refPrice]);

  // Calcular % de TP respecto al precio de ejecución
  const tpPercent = useMemo(() => {
    if (!tpslBoxData) return 0;
    const ref = orderPlan.refPrice;
    const { tpPrice } = tpslBoxData;
    if (!ref || !tpPrice) return 0;
    return Math.abs((tpPrice - ref) / ref);
  }, [tpslBoxData, orderPlan.refPrice]);

  // Calcular cantidad basada en el modo
  const calculatedQuantity = useMemo(() => {
    if (!tpslBoxData || !symbolConfig) return { qty: 0, investment: 0 };

    // Con MARKET la orden se llena al precio actual, no en la entrada de la caja: la cantidad y
    // el riesgo se calculan con ese precio (antes, con el precio lejos, el riesgo real era mayor)
    const entryPrice = orderPlan.refPrice;
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
    // El bot entrega step_size (snake_case); stepSize nunca existia y siempre caia en 0.001
    const stepSize = parseFloat(symbolConfig.step_size ?? symbolConfig.stepSize) || 0.001;
    qty = Math.floor(qty / stepSize) * stepSize;

    // Redondear a la precisión correcta
    const decimals = stepSize.toString().split('.')[1]?.length || 0;
    qty = parseFloat(qty.toFixed(decimals));

    return {
      qty,
      investment: qty * entryPrice
    };
  }, [tpslBoxData, symbolConfig, orderPlan.refPrice, quantityMode, fixedAmount, riskAmount, slPercent]);

  // Calcular ganancia potencial y pérdida potencial (desde el precio de ejecución)
  const potentialPnL = useMemo(() => {
    if (!tpslBoxData || calculatedQuantity.qty <= 0 || !orderPlan.refPrice) {
      return { profit: 0, loss: 0 };
    }

    const { slPrice, tpPrice } = tpslBoxData;
    const entryPrice = orderPlan.refPrice;
    const qty = calculatedQuantity.qty;

    // Para LONG: profit si sube a TP, loss si baja a SL
    // Para SHORT: profit si baja a TP, loss si sube a SL
    const profit = Math.abs(tpPrice - entryPrice) * qty;
    const loss = Math.abs(entryPrice - slPrice) * qty;

    return { profit, loss };
  }, [tpslBoxData, calculatedQuantity, orderPlan.refPrice]);

  // Risk/Reward ratio
  const riskRewardRatio = useMemo(() => {
    if (potentialPnL.loss === 0) return '∞';
    const ratio = potentialPnL.profit / potentialPnL.loss;
    return `1:${ratio.toFixed(2)}`;
  }, [potentialPnL]);

  // Tipo de orden calculado en orderPlan
  const orderType = orderPlan.type;

  // Handler para preparar orden
  const handlePrepareOrder = useCallback(() => {
    if (!tpslBoxData || calculatedQuantity.qty <= 0 || orderPlan.block) return;

    const order = {
      // La caja es de una moneda: si no es la del panel, TradingPanel no la envia
      symbol: tpslBoxData.symbol || symbol,
      side,
      quantity: calculatedQuantity.qty,
      stopLoss: tpslBoxData.slPrice,
      takeProfit: tpslBoxData.tpPrice,
      // LIMIT: precio de la entrada. MARKET: precio actual, que es al que se llena
      entryPrice: orderPlan.refPrice,
      investment: calculatedQuantity.investment,
      potentialProfit: potentialPnL.profit,
      potentialLoss: potentialPnL.loss,
      orderType
    };

    setPendingOrder(order);
    setShowConfirmation(true);
  }, [symbol, side, tpslBoxData, calculatedQuantity, potentialPnL, orderType, orderPlan]);

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

  // Formatear precio según el tick de la moneda
  const formatPrice = (price) => (price ? fmtPrice(price, symbolConfig) : '--');

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

        {/* Tipo de Orden */}
        <div className="order-form-section">
          <h4>Tipo de Orden</h4>
          <div className="quantity-mode-toggle">
            <button
              className={`mode-btn ${orderTypeMode === 'auto' ? 'active' : ''}`}
              onClick={() => setOrderTypeMode('auto')}
              title="Automático: LIMIT si entry ≠ precio actual, MARKET si son similares"
            >
              🤖 Auto
            </button>
            <button
              className={`mode-btn ${orderTypeMode === 'market' ? 'active' : ''}`}
              onClick={() => setOrderTypeMode('market')}
              title="Siempre ejecutar como MARKET (inmediato al precio actual)"
            >
              ⚡ Market
            </button>
            <button
              className={`mode-btn ${orderTypeMode === 'limit' ? 'active' : ''}`}
              onClick={() => setOrderTypeMode('limit')}
              title="Siempre ejecutar como LIMIT (espera al entry price)"
            >
              🎯 Limit
            </button>
          </div>
          <div style={{
            fontSize: '11px',
            color: '#666',
            marginTop: '6px',
            padding: '6px',
            background: '#f5f5f5',
            borderRadius: '4px'
          }}>
            {orderTypeMode === 'auto' && '🤖 Auto: Detecta automáticamente según diferencia de precio (>0.1%)'}
            {orderTypeMode === 'market' && '⚡ Market: Ejecución inmediata al precio de mercado actual'}
            {orderTypeMode === 'limit' && '🎯 Limit: Espera a que el precio alcance el entry price dibujado'}
            {orderPlan.block ? (
              <div style={{ marginTop: '4px', fontWeight: '600', color: '#ef4444' }}>
                ⚠️ {orderPlan.block}
              </div>
            ) : (
              <div style={{ marginTop: '4px', fontWeight: '600', color: orderType === 'LIMIT' ? '#f59e0b' : '#10b981' }}>
                → Se ejecutará como: {orderType}
              </div>
            )}
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
            disabled={disabled || calculatedQuantity.qty <= 0 || !!orderPlan.block}
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
              ✅ {orderStatus.message || 'Orden ejecutada exitosamente'}
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
                <span className="value" style={{
                  color: pendingOrder.orderType === 'LIMIT' ? '#f59e0b' : '#10b981',
                  fontWeight: '600'
                }}>
                  {pendingOrder.orderType}
                </span>
              </div>
              {pendingOrder.orderType === 'LIMIT' && (
                <div className="confirmation-info" style={{
                  fontSize: '11px',
                  color: '#f59e0b',
                  fontStyle: 'italic',
                  marginTop: '4px'
                }}>
                  ℹ️ Orden límite: se ejecutará cuando el precio alcance ${formatPrice(pendingOrder.entryPrice)}
                </div>
              )}
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
