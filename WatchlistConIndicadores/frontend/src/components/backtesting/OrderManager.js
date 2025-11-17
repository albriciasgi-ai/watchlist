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
    this.orders = []; // Todas las órdenes (abiertas y cerradas)
    this.openOrders = []; // Solo órdenes abiertas
    this.closedOrders = []; // Órdenes cerradas
    this.initialBalance = initialBalance;
    this.currentBalance = initialBalance;
    this.unrealizedPnL = 0;
    this.realizedPnL = 0;
    this.nextOrderId = 1;

    // Callbacks
    this.onOrderCreated = null;
    this.onOrderClosed = null;
    this.onBalanceUpdate = null;

    console.log('[OrderManager] Inicializado con balance:', initialBalance);
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
      status: 'open', // 'open', 'closed'
      exitPrice: null,
      exitTime: null,
      pnl: 0,
      pnlPercent: 0,
      commission: 0
    };

    // Calcular comisión (0.1% por defecto)
    order.commission = (entryPrice * quantity * 0.001);

    this.orders.push(order);
    this.openOrders.push(order);

    console.log('[OrderManager] Orden creada:', {
      id: order.id,
      type: order.type,
      side: order.side,
      entryPrice: order.entryPrice,
      quantity: order.quantity
    });

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
   */
  updateOrders(currentPrice, currentTime) {
    let ordersToClose = [];

    // Recorrer órdenes abiertas
    this.openOrders.forEach(order => {
      // Calcular PnL no realizado
      const pnlInfo = this.calculatePnL(order, currentPrice);
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

    if (ordersToClose.length > 0 && this.onBalanceUpdate) {
      this.onBalanceUpdate(this.getBalance());
    }
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

    // Calcular máximo drawdown
    let maxDrawdown = 0;
    let peak = this.initialBalance;
    let currentEquity = this.initialBalance;

    this.closedOrders.forEach(order => {
      currentEquity += order.pnl;
      if (currentEquity > peak) {
        peak = currentEquity;
      }
      const drawdown = ((peak - currentEquity) / peak) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    });

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
   * Resetea el manager
   */
  reset(initialBalance = 10000) {
    this.orders = [];
    this.openOrders = [];
    this.closedOrders = [];
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
    this.nextOrderId = Math.max(...this.orders.map(o => o.id), 0) + 1;

    // Recalcular PnL
    this.realizedPnL = this.closedOrders.reduce((sum, o) => sum + o.pnl, 0);
    this.unrealizedPnL = this.openOrders.reduce((sum, o) => sum + (o.currentPnl || 0), 0);

    console.log('[OrderManager] Datos importados');
  }
}

export default OrderManager;
