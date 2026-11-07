import React, { useState, useEffect } from 'react';
import OrderConfirmationModal from './OrderConfirmationModal';
import AnalysisLevels from './AnalysisLevels';
import { autoOrderType, orderEntry, orderPreview, orderQuantity, priceAtPercent } from './orderPlan.js';

const SIZE_MODE_KEY = 'backtesting_order_size_mode';

function savedSizeMode() {
  try {
    return localStorage.getItem(SIZE_MODE_KEY) === 'risk' ? 'risk' : 'fixed';
  } catch {
    return 'fixed';
  }
}

const TradingControls = ({ symbol, orderManager, currentPrice, currentTime, chartBox, onOrderCreated }) => {
  const [orderType, setOrderType] = useState('auto');
  const [orderSide, setOrderSide] = useState('long');
  const [sizeMode, setSizeMode] = useState(savedSizeMode); // 'fixed' o 'risk'
  const [useChartBox, setUseChartBox] = useState(true);
  const [riskUSDT, setRiskUSDT] = useState('10');
  const [quantityUSDT, setQuantityUSDT] = useState('100'); // 🎯 NUEVO: Cantidad en USDT en lugar de monedas
  const [entryPrice, setEntryPrice] = useState('');
  const [stopLossPercent, setStopLossPercent] = useState('');
  const [takeProfitPercent, setTakeProfitPercent] = useState('');
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
    }
  }, [currentPrice, useCurrentPrice, orderType]);

  // 🎯 FIX: Desactivar auto-actualización cuando se cambie a 'limit'
  useEffect(() => {
    if (orderType === 'limit' && useCurrentPrice) {
      setUseCurrentPrice(false);
      console.log(`[TradingControls] Auto-actualización desactivada para orden limit`);
    }
  }, [orderType]);

  // La orden sale de la caja del gráfico o, sin caja, de los campos del panel
  const box = useChartBox ? chartBox : null;
  const side = box ? box.side : orderSide;
  const entry = orderEntry({ box, useCurrentPrice, currentPrice, typedEntry: entryPrice, orderType });
  const stopLoss = box ? box.slPrice : priceAtPercent(entry, side, stopLossPercent, false);
  const takeProfit = box ? box.tpPrice : priceAtPercent(entry, side, takeProfitPercent, true);
  const finalType = orderType === 'auto' && currentPrice && entry > 0 ? autoOrderType(entry, currentPrice, side) : orderType;
  const fillPrice = finalType === 'market' ? currentPrice : entry;
  const quantity = orderQuantity({
    mode: sizeMode,
    amount: parseFloat(sizeMode === 'risk' ? riskUSDT : quantityUSDT),
    entry: fillPrice,
    stopLoss
  });
  const preview = orderPreview({ quantity, entry: fillPrice, stopLoss, takeProfit });

  const changeSizeMode = (mode) => {
    setSizeMode(mode);
    try {
      localStorage.setItem(SIZE_MODE_KEY, mode);
    } catch {
      // Sin almacenamiento el modo sigue vigente hasta recargar
    }
  };

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

    // Validaciones
    if (isNaN(entry) || entry <= 0) {
      alert('Precio de entrada inválido');
      return;
    }

    if (!box && stopLossPercent && !stopLoss) {
      alert('Stop Loss % inválido');
      return;
    }

    if (!box && takeProfitPercent && !takeProfit) {
      alert('Take Profit % inválido');
      return;
    }

    if (sizeMode === 'risk' && !stopLoss) {
      alert('Para calcular por riesgo la orden necesita un Stop Loss');
      return;
    }

    if (quantity <= 0) {
      alert('Cantidad inválida');
      return;
    }

    // Crear orden
    console.log('[TradingControls] Creando orden con:', {
      type: finalType,
      entryPrice: entry,
      currentPrice: currentPrice,
      currentTime: new Date(currentTime).toISOString(),
      side,
      quantity
    });

    const order = orderManager.createOrder({
      type: finalType,
      side,
      quantity,
      entryPrice: fillPrice,
      currentTime,
      currentPrice, // 🎯 NUEVO: Pasar precio actual del mercado
      stopLoss,
      takeProfit,
      notes
    });
    order.tpslBoxId = box?.id ?? null;

    console.log('[TradingControls] Orden creada:', order);

    // 🎯 Mostrar modal de confirmación SOLO para market orders
    // Las limit orders mostrarán el popup cuando se ejecuten
    if (finalType === 'market') {
      setLastCreatedOrder(order);
      setShowConfirmation(true);
    } else {
      // Para limit/stop, mostrar mensaje en consola
      console.log(`[TradingControls] Orden ${finalType.toUpperCase()} pendiente creada - Se ejecutará cuando el precio llegue a $${entry.toFixed(2)}`);
    }

    if (onOrderCreated) {
      onOrderCreated(order);
    }

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
   * 🎯 MODIFICADO: Ahora simplemente establece los porcentajes directamente
   */
  const handleAutoSLTP = (slPercent, tpPercent) => {
    const price = parseFloat(entryPrice);

    if (isNaN(price)) {
      alert('Primero ingresa un precio de entrada');
      return;
    }

    // 🎯 NUEVO: Ahora solo establecemos los porcentajes directamente
    setStopLossPercent(slPercent.toString());
    setTakeProfitPercent(tpPercent.toString());
  };

  return (
    <div className="trading-controls">
      <h3>Panel de Trading</h3>

      <div className="control-section">
        <label>Tipo de Orden</label>
        <select value={orderType} onChange={(e) => setOrderType(e.target.value)}>
          <option value="auto">Automática</option>
          <option value="market">Market</option>
          <option value="limit">Limit</option>
          <option value="stop">Stop</option>
        </select>
        {orderType === 'auto' && (
          <div className="price-hint">Se ejecutará como {finalType.toUpperCase()}. Si la entrada está a más de 0.1% del precio, espera ese precio.</div>
        )}
      </div>

      {chartBox && (
        <div className="control-section">
          <label>
            Caja TP/SL del gráfico
            <input
              type="checkbox"
              checked={useChartBox}
              onChange={(e) => setUseChartBox(e.target.checked)}
              style={{ marginLeft: '10px' }}
            />
            <span style={{ fontSize: '12px', marginLeft: '5px' }}>Usarla</span>
          </label>
          {box && (
            <div className="price-hint">
              {side.toUpperCase()} · Entrada ${box.entryPrice.toFixed(2)} · SL ${box.slPrice.toFixed(2)} · TP ${box.tpPrice.toFixed(2)}
            </div>
          )}
        </div>
      )}

      <div className="control-section">
        <label>Lado</label>
        <div className="side-buttons">
          <button
            className={`btn-side ${side === 'long' ? 'btn-long active' : 'btn-long'}`}
            onClick={() => setOrderSide('long')}
            disabled={!!box}
          >
            LONG 📈
          </button>
          <button
            className={`btn-side ${side === 'short' ? 'btn-short active' : 'btn-short'}`}
            onClick={() => setOrderSide('short')}
            disabled={!!box}
          >
            SHORT 📉
          </button>
        </div>
      </div>

      <div className="control-section">
        <label>Tamaño de la orden</label>
        <div className="quick-sltp">
          {[['fixed', 'Monto fijo'], ['risk', 'Por riesgo']].map(([mode, label]) => (
            <button
              key={mode}
              className="btn-quick"
              onClick={() => changeSizeMode(mode)}
              style={sizeMode === mode ? { background: '#2962ff', color: 'white' } : undefined}
            >
              {label}
            </button>
          ))}
        </div>
        {sizeMode === 'fixed' ? (
          <input
            type="number"
            step="10"
            value={quantityUSDT}
            onChange={(e) => setQuantityUSDT(e.target.value)}
            placeholder="Monto en USDT"
          />
        ) : (
          <input
            type="number"
            step="1"
            value={riskUSDT}
            onChange={(e) => setRiskUSDT(e.target.value)}
            placeholder="USDT a arriesgar"
          />
        )}
        <div className="price-hint">
          {quantity > 0
            ? `Inversión $${preview.investment.toFixed(2)}`
            : (sizeMode === 'risk' ? 'Por riesgo necesita un Stop Loss' : 'Escribe el monto')}
          {preview.loss !== null && quantity > 0 && ` · Pierde $${preview.loss.toFixed(2)}`}
          {preview.profit !== null && quantity > 0 && ` · Gana $${preview.profit.toFixed(2)}`}
          {preview.ratio !== null && quantity > 0 && ` · R/R 1:${preview.ratio.toFixed(2)}`}
        </div>
      </div>

      {!box && (
      <>
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
        <label>Stop Loss % (Opcional)</label>
        <input
          type="number"
          step="0.1"
          min="0"
          value={stopLossPercent}
          onChange={(e) => setStopLossPercent(e.target.value)}
          placeholder="Ej: 0.5 (= 0.5%)"
        />
        {stopLossPercent && entryPrice && (
          <div className="price-hint">
            ${(stopLoss || 0).toFixed(2)}
          </div>
        )}
      </div>

      <div className="control-section">
        <label>Take Profit % (Opcional)</label>
        <input
          type="number"
          step="0.1"
          min="0"
          value={takeProfitPercent}
          onChange={(e) => setTakeProfitPercent(e.target.value)}
          placeholder="Ej: 1 (= 1%)"
        />
        {takeProfitPercent && entryPrice && (
          <div className="price-hint">
            ${(takeProfit || 0).toFixed(2)}
          </div>
        )}
      </div>

      <div className="control-section">
        <label>SL/TP Rápido</label>
        <div className="quick-sltp">
          <button onClick={() => handleAutoSLTP(0.5, 1)} className="btn-quick">
            SL 0.5% / TP 1%
          </button>
          <button onClick={() => handleAutoSLTP(1, 2)} className="btn-quick">
            SL 1% / TP 2%
          </button>
          <button onClick={() => handleAutoSLTP(2, 4)} className="btn-quick">
            SL 2% / TP 4%
          </button>
        </div>
      </div>
      </>
      )}

      <div className="control-section">
        <label>Notas (Opcional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Razón del trade, setup, etc."
          rows="2"
        />
      </div>

      <AnalysisLevels symbol={symbol} time={currentTime} />

      <div className="control-actions">
        <button
          className={`btn-create-order ${side === 'long' ? 'btn-long' : 'btn-short'}`}
          onClick={handleCreateOrder}
        >
          {side === 'long' ? '🟢 COMPRAR (LONG)' : '🔴 VENDER (SHORT)'}
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

// 🎯 OPTIMIZACIÓN: React.memo para evitar re-renders innecesarios
// Solo re-renderiza si las props relevantes cambian
export default React.memo(TradingControls);
