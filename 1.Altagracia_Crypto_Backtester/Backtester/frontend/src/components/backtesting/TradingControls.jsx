import React, { useState, useEffect } from 'react';
import OrderConfirmationModal from './OrderConfirmationModal';

const TradingControls = ({ orderManager, currentPrice, currentTime, onOrderCreated }) => {
  const [orderType, setOrderType] = useState('market');
  const [orderSide, setOrderSide] = useState('long');
  const [quantity, setQuantity] = useState('0.01');
  const [entryPrice, setEntryPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [notes, setNotes] = useState('');
  const [useCurrentPrice, setUseCurrentPrice] = useState(true);

  // 🎯 Estado para modal de confirmación
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [lastCreatedOrder, setLastCreatedOrder] = useState(null);

  // 🎯 NUEVO: Conectar callback para mostrar popup cuando limit orders se ejecuten
  useEffect(() => {
    if (orderManager && !orderManager.onOrderExecuted) {
      orderManager.onOrderExecuted = (executedOrder) => {
        console.log('[TradingControls] Orden pendiente ejecutada, mostrando popup:', executedOrder);
        setLastCreatedOrder(executedOrder);
        setShowConfirmation(true);
      };
    }
  }, [orderManager]);

  // Actualizar precio de entrada con el precio actual
  // 🎯 FIX: NO actualizar automáticamente si el tipo de orden es 'limit'
  useEffect(() => {
    if (useCurrentPrice && currentPrice && orderType !== 'limit') {
      const newPrice = currentPrice.toFixed(2);
      setEntryPrice(newPrice);
      console.log(`[TradingControls] Precio actualizado automáticamente: ${newPrice}`);
    }
  }, [currentPrice, useCurrentPrice, orderType]);

  // 🎯 FIX: Desactivar auto-actualización cuando se cambie a 'limit'
  useEffect(() => {
    if (orderType === 'limit' && useCurrentPrice) {
      setUseCurrentPrice(false);
      console.log(`[TradingControls] Auto-actualización desactivada para orden limit`);
    }
  }, [orderType]);

  /**
   * Maneja la creación de una orden
   */
  const handleCreateOrder = () => {
    if (!orderManager) {
      alert('OrderManager no inicializado. Por favor reinicia el backtesting.');
      console.error('[TradingControls] orderManager es null');
      return;
    }

    if (!currentPrice) {
      alert('Precio actual no disponible. Por favor inicia la reproducción primero.');
      console.error('[TradingControls] currentPrice es null');
      return;
    }

    if (!currentTime) {
      alert('Tiempo actual no disponible. Por favor inicia la reproducción primero.');
      console.error('[TradingControls] currentTime es null');
      return;
    }

    const qty = parseFloat(quantity);
    const price = parseFloat(entryPrice);
    const sl = stopLoss ? parseFloat(stopLoss) : null;
    const tp = takeProfit ? parseFloat(takeProfit) : null;

    // Validaciones
    if (isNaN(qty) || qty <= 0) {
      alert('Cantidad inválida');
      return;
    }

    if (isNaN(price) || price <= 0) {
      alert('Precio de entrada inválido');
      return;
    }

    if (sl !== null && isNaN(sl)) {
      alert('Stop Loss inválido');
      return;
    }

    if (tp !== null && isNaN(tp)) {
      alert('Take Profit inválido');
      return;
    }

    // Validar SL/TP según el lado
    if (orderSide === 'long') {
      if (sl !== null && sl >= price) {
        alert('Stop Loss debe ser menor que el precio de entrada en long');
        return;
      }
      if (tp !== null && tp <= price) {
        alert('Take Profit debe ser mayor que el precio de entrada en long');
        return;
      }
    } else {
      if (sl !== null && sl <= price) {
        alert('Stop Loss debe ser mayor que el precio de entrada en short');
        return;
      }
      if (tp !== null && tp >= price) {
        alert('Take Profit debe ser menor que el precio de entrada en short');
        return;
      }
    }

    // Crear orden
    console.log('[TradingControls] Creando orden con:', {
      entryPrice: price,
      currentPrice: currentPrice,
      currentTime: new Date(currentTime).toISOString(),
      side: orderSide,
      quantity: qty
    });

    const order = orderManager.createOrder({
      type: orderType,
      side: orderSide,
      quantity: qty,
      entryPrice: price,
      currentTime,
      currentPrice, // 🎯 NUEVO: Pasar precio actual del mercado
      stopLoss: sl,
      takeProfit: tp,
      notes
    });

    console.log('[TradingControls] Orden creada:', order);

    // 🎯 Mostrar modal de confirmación SOLO para market orders
    // Las limit orders mostrarán el popup cuando se ejecuten
    if (orderType === 'market') {
      setLastCreatedOrder(order);
      setShowConfirmation(true);
    } else {
      // Para limit/stop, mostrar mensaje en consola
      console.log(`[TradingControls] Orden ${orderType.toUpperCase()} pendiente creada - Se ejecutará cuando el precio llegue a $${price.toFixed(2)}`);
    }

    if (onOrderCreated) {
      onOrderCreated(order);
    }

    // Limpiar notas
    setNotes('');
  };

  /**
   * Cierra todas las órdenes abiertas
   */
  const handleCloseAllOrders = () => {
    if (!orderManager || !currentPrice || !currentTime) return;

    const openOrders = orderManager.getOpenOrders();

    if (openOrders.length === 0) {
      alert('No hay órdenes abiertas');
      return;
    }

    if (!confirm(`¿Cerrar ${openOrders.length} orden(es) abiertas?`)) {
      return;
    }

    // 🎯 FIX: Copiar los IDs antes de iterar para evitar problemas de modificación del array
    const orderIds = openOrders.map(order => order.id);

    orderIds.forEach(orderId => {
      orderManager.closeOrder(orderId, currentPrice, currentTime, 'manual_close_all');
    });

    console.log('[TradingControls] Todas las órdenes cerradas:', orderIds.length);
  };

  /**
   * Auto-calcula SL/TP basado en porcentaje
   */
  const handleAutoSLTP = (slPercent, tpPercent) => {
    const price = parseFloat(entryPrice);

    if (isNaN(price)) {
      alert('Primero ingresa un precio de entrada');
      return;
    }

    if (orderSide === 'long') {
      const sl = price * (1 - slPercent / 100);
      const tp = price * (1 + tpPercent / 100);
      setStopLoss(sl.toFixed(2));
      setTakeProfit(tp.toFixed(2));
    } else {
      const sl = price * (1 + slPercent / 100);
      const tp = price * (1 - tpPercent / 100);
      setStopLoss(sl.toFixed(2));
      setTakeProfit(tp.toFixed(2));
    }
  };

  return (
    <div className="trading-controls">
      <h3>Panel de Trading</h3>

      <div className="control-section">
        <label>Tipo de Orden</label>
        <select value={orderType} onChange={(e) => setOrderType(e.target.value)}>
          <option value="market">Market</option>
          <option value="limit">Limit</option>
          <option value="stop">Stop</option>
        </select>
      </div>

      <div className="control-section">
        <label>Lado</label>
        <div className="side-buttons">
          <button
            className={`btn-side ${orderSide === 'long' ? 'btn-long active' : 'btn-long'}`}
            onClick={() => setOrderSide('long')}
          >
            LONG 📈
          </button>
          <button
            className={`btn-side ${orderSide === 'short' ? 'btn-short active' : 'btn-short'}`}
            onClick={() => setOrderSide('short')}
          >
            SHORT 📉
          </button>
        </div>
      </div>

      <div className="control-section">
        <label>Cantidad</label>
        <input
          type="number"
          step="0.001"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="0.01"
        />
      </div>

      <div className="control-section">
        <label>
          Precio de Entrada
          <input
            type="checkbox"
            checked={useCurrentPrice}
            onChange={(e) => setUseCurrentPrice(e.target.checked)}
            style={{ marginLeft: '10px' }}
          />
          <span style={{ fontSize: '12px', marginLeft: '5px' }}>Usar precio actual</span>
        </label>
        <input
          type="number"
          step="0.01"
          value={entryPrice}
          onChange={(e) => setEntryPrice(e.target.value)}
          placeholder="Precio"
          disabled={useCurrentPrice}
        />
        {currentPrice && (
          <div className="price-hint">Actual: ${currentPrice.toFixed(2)}</div>
        )}
      </div>

      <div className="control-section">
        <label>Stop Loss (Opcional)</label>
        <input
          type="number"
          step="0.01"
          value={stopLoss}
          onChange={(e) => setStopLoss(e.target.value)}
          placeholder="SL"
        />
      </div>

      <div className="control-section">
        <label>Take Profit (Opcional)</label>
        <input
          type="number"
          step="0.01"
          value={takeProfit}
          onChange={(e) => setTakeProfit(e.target.value)}
          placeholder="TP"
        />
      </div>

      <div className="control-section">
        <label>SL/TP Rápido</label>
        <div className="quick-sltp">
          <button onClick={() => handleAutoSLTP(2, 4)} className="btn-quick">
            SL 2% / TP 4%
          </button>
          <button onClick={() => handleAutoSLTP(3, 6)} className="btn-quick">
            SL 3% / TP 6%
          </button>
          <button onClick={() => handleAutoSLTP(5, 10)} className="btn-quick">
            SL 5% / TP 10%
          </button>
        </div>
      </div>

      <div className="control-section">
        <label>Notas (Opcional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Razón del trade, setup, etc."
          rows="2"
        />
      </div>

      <div className="control-actions">
        <button
          className={`btn-create-order ${orderSide === 'long' ? 'btn-long' : 'btn-short'}`}
          onClick={handleCreateOrder}
        >
          {orderSide === 'long' ? '🟢 COMPRAR (LONG)' : '🔴 VENDER (SHORT)'}
        </button>

        <button
          className="btn-close-all"
          onClick={handleCloseAllOrders}
        >
          ❌ Cerrar Todas
        </button>
      </div>

      {/* 🎯 Modal de confirmación de orden */}
      {showConfirmation && lastCreatedOrder && (
        <OrderConfirmationModal
          order={lastCreatedOrder}
          currentPrice={currentPrice}
          onClose={() => {
            setShowConfirmation(false);
            setLastCreatedOrder(null);
          }}
        />
      )}
    </div>
  );
};

export default TradingControls;
