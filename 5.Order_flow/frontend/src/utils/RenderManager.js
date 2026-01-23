/**
 * RenderManager - Sistema optimizado de renderizado por capas
 *
 * Separa el renderizado en 3 capas:
 * 1. Precio/Velas en progreso (alta frecuencia)
 * 2. Indicadores técnicos (solo al cerrar velas)
 * 3. UI estática (baja frecuencia)
 */

class RenderManager {
  constructor(symbol, interval) {
    this.symbol = symbol;
    this.interval = interval;
    this.lastCandleClose = null;
    this.lastPriceUpdate = 0;
    this.lastIndicatorUpdate = 0;
    this.pendingPriceUpdate = false;
    this.pendingIndicatorUpdate = false;
    this.priceThrottle = 250; // ms - actualización de precio cada 250ms máximo
    this.debug = false;
  }

  /**
   * Obtiene el intervalo en milisegundos según el timeframe
   */
  getIntervalMs() {
    const intervals = {
      '1': 60 * 1000,        // 1 minuto
      '3': 3 * 60 * 1000,    // 3 minutos
      '5': 5 * 60 * 1000,    // 5 minutos
      '15': 15 * 60 * 1000,  // 15 minutos
      '30': 30 * 60 * 1000,  // 30 minutos
      '60': 60 * 60 * 1000,  // 1 hora
      '120': 2 * 60 * 60 * 1000, // 2 horas
      '240': 4 * 60 * 60 * 1000, // 4 horas
      'D': 24 * 60 * 60 * 1000,  // 1 día
      'W': 7 * 24 * 60 * 60 * 1000 // 1 semana
    };
    return intervals[this.interval] || 60000;
  }

  /**
   * Detecta si una vela se ha cerrado
   */
  isCandleClosed(currentCandle, previousCandle) {
    if (!previousCandle || !currentCandle) return false;

    // Si el timestamp cambió, significa que se cerró la vela anterior
    return currentCandle.timestamp !== previousCandle.timestamp;
  }

  /**
   * Determina si se debe actualizar el precio
   */
  shouldUpdatePrice() {
    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastPriceUpdate;

    // Actualizar precio máximo cada 250ms
    if (timeSinceLastUpdate >= this.priceThrottle) {
      this.lastPriceUpdate = now;
      return true;
    }

    return false;
  }

  /**
   * Determina si se deben actualizar los indicadores
   */
  shouldUpdateIndicators(currentCandle) {
    // Solo actualizar cuando se cierra una vela
    if (this.isCandleClosed(currentCandle, this.lastCandleClose)) {
      this.lastCandleClose = currentCandle;
      this.lastIndicatorUpdate = Date.now();

      if (this.debug) {
        console.log(`[${this.symbol}] 🕐 Vela cerrada - actualizando indicadores`);
      }

      return true;
    }

    return false;
  }

  /**
   * Maneja actualización de WebSocket
   */
  handleWebSocketUpdate(data, callbacks) {
    const { onPriceUpdate, onIndicatorUpdate } = callbacks;

    // Actualización de precio (ticker)
    if (data.topic && data.topic.startsWith("tickers.")) {
      if (this.shouldUpdatePrice() && onPriceUpdate) {
        onPriceUpdate(data);
      } else {
        this.pendingPriceUpdate = true;
      }
    }

    // Actualización de vela (kline)
    if (data.topic && data.topic.startsWith("kline.")) {
      const klineData = data.data;
      if (klineData && klineData.length > 0) {
        const candle = klineData[0];

        // Si la vela está confirmada (cerrada)
        if (candle.confirm) {
          if (this.shouldUpdateIndicators({ timestamp: candle.start }) && onIndicatorUpdate) {
            onIndicatorUpdate(data);
          } else {
            this.pendingIndicatorUpdate = true;
          }
        } else if (this.shouldUpdatePrice() && onPriceUpdate) {
          // Vela en progreso - solo actualizar precio
          onPriceUpdate(data);
        }
      }
    }
  }

  /**
   * Procesa actualizaciones pendientes
   */
  processPendingUpdates(callbacks) {
    const { onPriceUpdate, onIndicatorUpdate } = callbacks;

    if (this.pendingPriceUpdate && this.shouldUpdatePrice()) {
      this.pendingPriceUpdate = false;
      if (onPriceUpdate) onPriceUpdate();
    }

    if (this.pendingIndicatorUpdate) {
      this.pendingIndicatorUpdate = false;
      if (onIndicatorUpdate) onIndicatorUpdate();
    }
  }

  /**
   * Obtiene estadísticas de rendimiento
   */
  getStats() {
    const now = Date.now();
    return {
      timeSinceLastPrice: now - this.lastPriceUpdate,
      timeSinceLastIndicator: now - this.lastIndicatorUpdate,
      intervalMs: this.getIntervalMs(),
      hasPendingUpdates: this.pendingPriceUpdate || this.pendingIndicatorUpdate
    };
  }

  /**
   * Limpia el manager
   */
  destroy() {
    this.lastCandleClose = null;
    this.lastPriceUpdate = 0;
    this.lastIndicatorUpdate = 0;
    this.pendingPriceUpdate = false;
    this.pendingIndicatorUpdate = false;
  }
}

export default RenderManager;