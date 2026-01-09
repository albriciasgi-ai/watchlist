/**
 * OrderManager - Sistema de gestión de órdenes para backtesting
 *
 * Características:
 * - Crear órdenes (market, limit, stop)
 * - Gestionar TP/SL
 * - Calcular PnL
 * - Rastrear métricas de rendimiento
 */

class OrderManager {
  constructor(initialBalance = 10000) {
    this.orders = []; // Todas las órdenes (abiertas, cerradas y pendientes)
    this.openOrders = []; // Solo órdenes abiertas (ejecutadas)
    this.closedOrders = []; // Órdenes cerradas
    this.pendingOrders = []; // 🎯 NUEVO: Órdenes pendientes (limit/stop no ejecutadas)
    this.initialBalance = initialBalance;
    this.currentBalance = initialBalance;
    this.unrealizedPnL = 0;
    this.realizedPnL = 0;
    this.nextOrderId = 1;

    // Callbacks (legacy support)
    this.onOrderCreated = null;
    this.onOrderClosed = null;
    this.onBalanceUpdate = null;
    this.onOrderExecuted = null; // 🎯 NUEVO: Callback cuando una orden pendiente se ejecuta

    // 🎯 FIX: Sistema de eventos (event-driven pattern)
    this.eventListeners = {
      tradeOpened: [],
      tradeClosed: [],
      balanceChanged: [],
      orderExecuted: []
    };

    console.log('[OrderManager] Inicializado con balance:', initialBalance);
  }

  /**
   * 🎯 FIX: Subscribirse a eventos
   * @param {string} eventName - Nombre del evento ('tradeClosed', 'tradeOpened', 'balanceChanged', 'orderExecuted')
   * @param {function} callback - Función callback a ejecutar cuando ocurre el evento
   */
  on(eventName, callback) {
    if (this.eventListeners[eventName]) {
      this.eventListeners[eventName].push(callback);
      console.log(`[OrderManager] Listener registrado para evento: ${eventName}`);
    } else {
      console.warn(`[OrderManager] Evento desconocido: ${eventName}`);
    }
  }

  /**
   * 🎯 FIX: Remover subscripción a eventos
   * @param {string} eventName - Nombre del evento
   * @param {function} callback - Función callback a remover
   */
  off(eventName, callback) {
    if (this.eventListeners[eventName]) {
      this.eventListeners[eventName] = this.eventListeners[eventName].filter(
        cb => cb !== callback
      );
      console.log(`[OrderManager] Listener removido para evento: ${eventName}`);
    }
  }

  /**
   * 🎯 FIX: Emitir evento
   * @param {string} eventName - Nombre del evento
   * @param {any} data - Datos del evento
   */
  emit(eventName, data) {
    if (this.eventListeners[eventName]) {
      console.log(`[OrderManager] Emitiendo evento: ${eventName}`, data);
      this.eventListeners[eventName].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[OrderManager] Error en callback de ${eventName}:`, error);
        }
      });
    }
  }

  /**
   * Crea una nueva orden
   */
  createOrder({
    type = 'market', // 'market', 'limit', 'stop'
    side = 'long', // 'long' or 'short'
    quantity,
    entryPrice,
    currentTime,
    currentPrice = null, // 🎯 NUEVO: Precio actual del mercado
    stopLoss = null,
    takeProfit = null,
    notes = ''
  }) {
    const order = {
      id: this.nextOrderId++,
      type,
      side,
      quantity,
      entryPrice,
      entryTime: currentTime,
      stopLoss,
      takeProfit,
      notes,
      status: type === 'market' ? 'open' : 'pending', // 🎯 NUEVO: limit/stop empiezan como pending
      exitPrice: null,
      exitTime: null,
      pnl: 0,
      pnlPercent: 0,
      commission: 0,
      executedAt: null, // 🎯 NUEVO: Timestamp cuando se ejecutó (para pending orders)
      executedPrice: null // 🎯 NUEVO: Precio al que se ejecutó realmente
    };

    // 🎯 NUEVO: Para market orders, ejecutar inmediatamente
    if (type === 'market') {
      order.status = 'open';
      order.executedAt = currentTime;
      order.executedPrice = currentPrice || entryPrice;
      // Calcular comisión (0.1% por defecto)
      order.commission = (order.executedPrice * quantity * 0.001);

      this.orders.push(order);
      this.openOrders.push(order);

      console.log('[OrderManager] Orden MARKET ejecutada:', {
        id: order.id,
        side: order.side,
        price: order.executedPrice,
        quantity: order.quantity
      });
    } else {
      // 🎯 NUEVO: Limit/Stop orders van a pendientes
      order.status = 'pending';
      this.orders.push(order);
      this.pendingOrders.push(order);

      console.log('[OrderManager] Orden LIMIT/STOP pendiente:', {
        id: order.id,
        type: order.type,
        side: order.side,
        targetPrice: order.entryPrice,
        quantity: order.quantity
      });
    }

    if (this.onOrderCreated) {
      this.onOrderCreated(order);
    }

    return order;
  }

  /**
   * Cierra una orden manualmente
   */
  closeOrder(orderId, exitPrice, currentTime, reason = 'manual') {
    const orderIndex = this.openOrders.findIndex(o => o.id === orderId);

    if (orderIndex === -1) {
      console.error('[OrderManager] Orden no encontrada:', orderId);
      return null;
    }

    const order = this.openOrders[orderIndex];

    // Calcular PnL
    const pnlInfo = this.calculatePnL(order, exitPrice);

    order.exitPrice = exitPrice;
    order.exitTime = currentTime;
    order.status = 'closed';
    order.pnl = pnlInfo.pnl;
    order.pnlPercent = pnlInfo.pnlPercent;
    order.closeReason = reason;

    // Actualizar balance
    this.currentBalance += pnlInfo.pnl;
    this.realizedPnL += pnlInfo.pnl;

    // Mover a cerradas
    this.openOrders.splice(orderIndex, 1);
    this.closedOrders.push(order);

    console.log('[OrderManager] Orden cerrada:', {
      id: order.id,
      pnl: order.pnl.toFixed(2),
      pnlPercent: order.pnlPercent.toFixed(2) + '%',
      reason
    });

    // 🎯 FIX: Emitir evento de trade cerrado (event-driven)
    this.emit('tradeClosed', {
      order: order,
      balance: this.getBalance(),
      metrics: this.getMetrics(),
      timestamp: currentTime
    });

    // Legacy callback support
    if (this.onOrderClosed) {
      this.onOrderClosed(order);
    }

    if (this.onBalanceUpdate) {
      this.onBalanceUpdate(this.getBalance());
    }

    return order;
  }

  /**
   * Calcula PnL de una orden
   */
  calculatePnL(order, currentPrice) {
    let pnl = 0;
    let pnlPercent = 0;

    if (order.side === 'long') {
      pnl = (currentPrice - order.entryPrice) * order.quantity;
    } else {
      pnl = (order.entryPrice - currentPrice) * order.quantity;
    }

    // Restar comisión de salida
    const exitCommission = currentPrice * order.quantity * 0.001;
    pnl -= (order.commission + exitCommission);

    pnlPercent = (pnl / (order.entryPrice * order.quantity)) * 100;

    return { pnl, pnlPercent };
  }

  /**
   * Actualiza órdenes abiertas con el precio actual
   * Ejecuta stop loss y take profit automáticamente
   * 🎯 NUEVO: También ejecuta órdenes pendientes (limit/stop)
   */
  updateOrders(currentPrice, currentTime) {
    let ordersToClose = [];
    let ordersToExecute = [];

    // 🎯 NUEVO: Verificar órdenes pendientes que deben ejecutarse
    this.pendingOrders.forEach(order => {
      let shouldExecute = false;

      if (order.type === 'limit') {
        // Limit order se ejecuta cuando el precio TOCA el precio límite
        if (order.side === 'long' && currentPrice <= order.entryPrice) {
          // Long limit: comprar cuando el precio baje al límite
          shouldExecute = true;
        } else if (order.side === 'short' && currentPrice >= order.entryPrice) {
          // Short limit: vender cuando el precio suba al límite
          shouldExecute = true;
        }
      } else if (order.type === 'stop') {
        // Stop order se ejecuta cuando el precio SUPERA el precio stop
        if (order.side === 'long' && currentPrice >= order.entryPrice) {
          // Long stop: comprar cuando el precio sube al stop
          shouldExecute = true;
        } else if (order.side === 'short' && currentPrice <= order.entryPrice) {
          // Short stop: vender cuando el precio baja al stop
          shouldExecute = true;
        }
      }

      if (shouldExecute) {
        ordersToExecute.push(order);
      }
    });

    // 🎯 NUEVO: Ejecutar órdenes pendientes
    ordersToExecute.forEach(order => {
      this.executePendingOrder(order, currentPrice, currentTime);
    });

    // Recorrer órdenes abiertas
    this.openOrders.forEach(order => {
      // Calcular PnL no realizado - usar el precio ejecutado real
      const entryPriceForCalc = order.executedPrice || order.entryPrice;
      const pnlInfo = this.calculatePnL({...order, entryPrice: entryPriceForCalc}, currentPrice);
      order.currentPnl = pnlInfo.pnl;
      order.currentPnlPercent = pnlInfo.pnlPercent;

      // Verificar Stop Loss
      if (order.stopLoss !== null) {
        if (order.side === 'long' && currentPrice <= order.stopLoss) {
          ordersToClose.push({ id: order.id, price: order.stopLoss, reason: 'stop_loss' });
        } else if (order.side === 'short' && currentPrice >= order.stopLoss) {
          ordersToClose.push({ id: order.id, price: order.stopLoss, reason: 'stop_loss' });
        }
      }

      // Verificar Take Profit
      if (order.takeProfit !== null) {
        if (order.side === 'long' && currentPrice >= order.takeProfit) {
          ordersToClose.push({ id: order.id, price: order.takeProfit, reason: 'take_profit' });
        } else if (order.side === 'short' && currentPrice <= order.takeProfit) {
          ordersToClose.push({ id: order.id, price: order.takeProfit, reason: 'take_profit' });
        }
      }
    });

    // Cerrar órdenes que tocaron SL/TP
    ordersToClose.forEach(({ id, price, reason }) => {
      this.closeOrder(id, price, currentTime, reason);
    });

    // Calcular PnL no realizado total
    this.unrealizedPnL = this.openOrders.reduce(
      (sum, order) => sum + (order.currentPnl || 0),
      0
    );

    if ((ordersToClose.length > 0 || ordersToExecute.length > 0) && this.onBalanceUpdate) {
      this.onBalanceUpdate(this.getBalance());
    }
  }

  /**
   * 🎯 NUEVO: Ejecuta una orden pendiente
   */
  executePendingOrder(order, executionPrice, currentTime) {
    // Remover de pendientes
    const pendingIndex = this.pendingOrders.indexOf(order);
    if (pendingIndex !== -1) {
      this.pendingOrders.splice(pendingIndex, 1);
    }

    // Actualizar orden
    order.status = 'open';
    order.executedAt = currentTime;
    order.executedPrice = executionPrice;
    order.commission = (executionPrice * order.quantity * 0.001);

    // Agregar a órdenes abiertas
    this.openOrders.push(order);

    console.log('[OrderManager] ✅ Orden pendiente EJECUTADA:', {
      id: order.id,
      type: order.type,
      side: order.side,
      targetPrice: order.entryPrice,
      executedPrice: executionPrice,
      quantity: order.quantity
    });

    // Notificar callback
    if (this.onOrderExecuted) {
      this.onOrderExecuted(order);
    }
  }

  /**
   * 🎯 NUEVO: Cancela una orden pendiente
   */
  cancelPendingOrder(orderId) {
    const orderIndex = this.pendingOrders.findIndex(o => o.id === orderId);

    if (orderIndex === -1) {
      console.error('[OrderManager] Orden pendiente no encontrada:', orderId);
      return false;
    }

    const order = this.pendingOrders[orderIndex];

    // Remover de pendientes
    this.pendingOrders.splice(orderIndex, 1);

    // Marcar como cancelada
    order.status = 'cancelled';
    order.cancelledAt = Date.now();

    console.log('[OrderManager] ❌ Orden pendiente CANCELADA:', {
      id: order.id,
      type: order.type,
      side: order.side,
      entryPrice: order.entryPrice
    });

    return true;
  }

  /**
   * Obtiene información del balance
   */
  getBalance() {
    return {
      initial: this.initialBalance,
      current: this.currentBalance,
      unrealizedPnL: this.unrealizedPnL,
      realizedPnL: this.realizedPnL,
      total: this.currentBalance + this.unrealizedPnL,
      totalPercent: ((this.currentBalance + this.unrealizedPnL - this.initialBalance) / this.initialBalance) * 100
    };
  }

  /**
   * Calcula el máximo crecimiento consecutivo (opuesto al drawdown)
   */
  calculateMaxGrowth() {
    let maxGrowth = 0;
    let maxGrowthUSD = 0;
    let currentGrowth = 0;
    let startBalance = this.initialBalance;
    let currentBalance = this.initialBalance;
    let inGrowthPeriod = false;

    this.closedOrders.forEach(order => {
      if (order.pnl > 0) {
        if (!inGrowthPeriod) {
          startBalance = currentBalance;
          inGrowthPeriod = true;
        }
        currentGrowth += order.pnl;
        currentBalance += order.pnl;
      } else {
        if (inGrowthPeriod) {
          const growthPercent = (currentGrowth / startBalance) * 100;
          if (growthPercent > maxGrowth) {
            maxGrowth = growthPercent;
            maxGrowthUSD = currentGrowth;
          }
          currentGrowth = 0;
          inGrowthPeriod = false;
        }
        currentBalance += order.pnl;
      }
    });

    // Verificar período final si terminó en crecimiento
    if (inGrowthPeriod && currentGrowth > 0) {
      const growthPercent = (currentGrowth / startBalance) * 100;
      if (growthPercent > maxGrowth) {
        maxGrowth = growthPercent;
        maxGrowthUSD = currentGrowth;
      }
    }

    return { maxGrowth, maxGrowthUSD };
  }

  /**
   * Obtiene métricas de rendimiento
   */
  getMetrics() {
    const totalTrades = this.closedOrders.length;
    const winningTrades = this.closedOrders.filter(o => o.pnl > 0);
    const losingTrades = this.closedOrders.filter(o => o.pnl <= 0);

    const winRate = totalTrades > 0
      ? (winningTrades.length / totalTrades) * 100
      : 0;

    const avgWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, o) => sum + o.pnl, 0) / winningTrades.length
      : 0;

    const avgLoss = losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum, o) => sum + o.pnl, 0) / losingTrades.length)
      : 0;

    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;

    // Calcular máximo drawdown (en % y $)
    let maxDrawdown = 0;
    let maxDrawdownUSD = 0;
    let peak = this.initialBalance;
    let peakUSD = this.initialBalance;
    let currentEquity = this.initialBalance;

    this.closedOrders.forEach(order => {
      currentEquity += order.pnl;
      if (currentEquity > peak) {
        peak = currentEquity;
        peakUSD = currentEquity;
      }
      const drawdown = ((peak - currentEquity) / peak) * 100;
      const drawdownUSD = peakUSD - currentEquity;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownUSD = drawdownUSD;
      }
    });

    // Calcular máximo crecimiento
    const growthData = this.calculateMaxGrowth();

    return {
      totalTrades,
      openTrades: this.openOrders.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      maxDrawdown,
      maxDrawdownUSD,
      maxGrowth: growthData.maxGrowth,
      maxGrowthUSD: growthData.maxGrowthUSD,
      largestWin: winningTrades.length > 0
        ? Math.max(...winningTrades.map(o => o.pnl))
        : 0,
      largestLoss: losingTrades.length > 0
        ? Math.min(...losingTrades.map(o => o.pnl))
        : 0
    };
  }

  /**
   * Obtiene todas las órdenes (abiertas y cerradas)
   */
  getAllOrders() {
    return this.orders;
  }

  /**
   * Obtiene solo órdenes abiertas
   */
  getOpenOrders() {
    return this.openOrders;
  }

  /**
   * Obtiene solo órdenes cerradas
   */
  getClosedOrders() {
    return this.closedOrders;
  }

  /**
   * 🎯 NUEVO: Obtiene solo órdenes pendientes
   */
  getPendingOrders() {
    return this.pendingOrders;
  }

  /**
   * Resetea el manager
   */
  reset(initialBalance = 10000) {
    this.orders = [];
    this.openOrders = [];
    this.closedOrders = [];
    this.pendingOrders = []; // 🎯 NUEVO
    this.initialBalance = initialBalance;
    this.currentBalance = initialBalance;
    this.unrealizedPnL = 0;
    this.realizedPnL = 0;
    this.nextOrderId = 1;

    console.log('[OrderManager] Reset completo');

    if (this.onBalanceUpdate) {
      this.onBalanceUpdate(this.getBalance());
    }
  }

  /**
   * Exporta datos a JSON
   */
  exportToJSON() {
    return {
      initialBalance: this.initialBalance,
      currentBalance: this.currentBalance,
      orders: this.orders,
      metrics: this.getMetrics(),
      balance: this.getBalance()
    };
  }

  /**
   * Importa datos desde JSON
   */
  importFromJSON(data) {
    this.initialBalance = data.initialBalance;
    this.currentBalance = data.currentBalance;
    this.orders = data.orders;
    this.openOrders = data.orders.filter(o => o.status === 'open');
    this.closedOrders = data.orders.filter(o => o.status === 'closed');
    this.pendingOrders = data.orders.filter(o => o.status === 'pending'); // 🎯 NUEVO
    this.nextOrderId = Math.max(...this.orders.map(o => o.id), 0) + 1;

    // Recalcular PnL
    this.realizedPnL = this.closedOrders.reduce((sum, o) => sum + o.pnl, 0);
    this.unrealizedPnL = this.openOrders.reduce((sum, o) => sum + (o.currentPnl || 0), 0);

    console.log('[OrderManager] Datos importados:', {
      open: this.openOrders.length,
      closed: this.closedOrders.length,
      pending: this.pendingOrders.length
    });
  }
}

export default OrderManager;
