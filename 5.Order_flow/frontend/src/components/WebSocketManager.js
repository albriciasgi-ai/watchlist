/**
 * WebSocketManager.js - Gestor centralizado de WebSocket con Throttling
 *
 * Optimizaciones:
 * - Throttling configurable (default 500ms)
 * - Buffer por símbolo (solo guarda último mensaje)
 * - Reduce CPU al procesar menos mensajes por segundo
 */

class WebSocketManager {
  constructor() {
    this.ws = null;
    this.subscribers = new Map();
    this.isConnected = false;
    this.reconnectTimeout = null;
    this.currentInterval = "15";

    // 🚀 THROTTLING: Buffer y configuración
    this.throttleMs = 500;           // Default: procesar cada 500ms
    this.messageBuffer = new Map();  // symbol -> { ticker: data, kline: data }
    this.throttleTimer = null;
    this.throttleEnabled = true;
  }

  /**
   * Configura el intervalo de throttling
   * @param {number} ms - Milisegundos entre procesamiento (100-2000)
   */
  setThrottleMs(ms) {
    this.throttleMs = Math.max(100, Math.min(2000, ms));
    console.log(`[WebSocketManager] Throttle set to ${this.throttleMs}ms`);
  }

  /**
   * Habilita o deshabilita el throttling
   */
  setThrottleEnabled(enabled) {
    this.throttleEnabled = enabled;
    if (!enabled && this.throttleTimer) {
      clearInterval(this.throttleTimer);
      this.throttleTimer = null;
    }
    console.log(`[WebSocketManager] Throttle ${enabled ? 'enabled' : 'disabled'}`);
  }

  connect(interval) {
    if (this.ws && this.currentInterval === interval) {
      return;
    }

    this.currentInterval = interval;

    if (this.ws) {
      this.ws.close();
    }

    const wsUrl = 'wss://stream.bybit.com/v5/public/linear';
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log(`WebSocket Manager conectado [${interval}]`);
      this.isConnected = true;

      // Iniciar timer de throttle
      this._startThrottleTimer();

      // Esperar 100ms antes de suscribir (Bybit necesita tiempo)
      setTimeout(() => {
        this.subscribeAll();
      }, 100);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Log de respuesta de suscripción
        if (data.op === "subscribe" && data.success) {
          console.log(`✓ Suscrito:`, data.ret_msg);
          return;
        }

        if (data.topic) {
          // Extraer símbolo del topic
          let symbol = null;
          let messageType = null;

          if (data.topic.startsWith('tickers.')) {
            symbol = data.topic.replace('tickers.', '');
            messageType = 'ticker';
          } else if (data.topic.startsWith('kline.')) {
            const parts = data.topic.split('.');
            symbol = parts[2];
            messageType = 'kline';
          }

          if (symbol && this.subscribers.has(symbol)) {
            if (this.throttleEnabled) {
              // 🚀 THROTTLE: Guardar en buffer (reemplaza anterior)
              if (!this.messageBuffer.has(symbol)) {
                this.messageBuffer.set(symbol, {});
              }
              this.messageBuffer.get(symbol)[messageType] = data;
            } else {
              // Sin throttle: procesar inmediatamente
              this._dispatchToSubscribers(symbol, data);
            }
          }
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket Manager error:', error);
    };

    this.ws.onclose = () => {
      console.log('WebSocket Manager cerrado');
      this.isConnected = false;
      this._stopThrottleTimer();

      // Reconectar después de 3 segundos
      this.reconnectTimeout = setTimeout(() => {
        this.connect(this.currentInterval);
      }, 3000);
    };
  }

  /**
   * Inicia el timer que procesa el buffer periódicamente
   */
  _startThrottleTimer() {
    if (this.throttleTimer) return;

    this.throttleTimer = setInterval(() => {
      this._processBuffer();
    }, this.throttleMs);
  }

  /**
   * Detiene el timer de throttle
   */
  _stopThrottleTimer() {
    if (this.throttleTimer) {
      clearInterval(this.throttleTimer);
      this.throttleTimer = null;
    }
  }

  /**
   * Procesa todos los mensajes acumulados en el buffer
   */
  _processBuffer() {
    if (this.messageBuffer.size === 0) return;

    // Procesar cada símbolo
    this.messageBuffer.forEach((messages, symbol) => {
      if (!this.subscribers.has(symbol)) return;

      // Despachar ticker primero (precio), luego kline (vela)
      if (messages.ticker) {
        this._dispatchToSubscribers(symbol, messages.ticker);
      }
      if (messages.kline) {
        this._dispatchToSubscribers(symbol, messages.kline);
      }
    });

    // Limpiar buffer
    this.messageBuffer.clear();
  }

  /**
   * Envía datos a todos los callbacks suscritos para un símbolo
   */
  _dispatchToSubscribers(symbol, data) {
    if (!this.subscribers.has(symbol)) return;

    const callbacks = this.subscribers.get(symbol);
    callbacks.forEach(cb => {
      try {
        cb(data);
      } catch (err) {
        console.error(`Error in subscriber callback for ${symbol}:`, err);
      }
    });
  }

  subscribe(symbol, callback) {
    if (!this.subscribers.has(symbol)) {
      this.subscribers.set(symbol, new Set());
    }
    this.subscribers.get(symbol).add(callback);

    // Si ya está conectado, suscribir inmediatamente
    if (this.isConnected && this.ws) {
      this.sendSubscription(symbol);
    }
  }

  unsubscribe(symbol, callback) {
    if (this.subscribers.has(symbol)) {
      this.subscribers.get(symbol).delete(callback);
      if (this.subscribers.get(symbol).size === 0) {
        this.subscribers.delete(symbol);
        // Limpiar buffer para este símbolo
        this.messageBuffer.delete(symbol);
        // Desuscribir del WebSocket
        if (this.isConnected && this.ws) {
          this.sendUnsubscription(symbol);
        }
      }
    }
  }

  sendSubscription(symbol) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      this.ws.send(JSON.stringify({
        op: "subscribe",
        args: [
          `kline.${this.currentInterval}.${symbol}`,
          `tickers.${symbol}`
        ]
      }));
    } catch (err) {
      console.error(`Error subscribing ${symbol}:`, err);
    }
  }

  sendUnsubscription(symbol) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      this.ws.send(JSON.stringify({
        op: "unsubscribe",
        args: [
          `kline.${this.currentInterval}.${symbol}`,
          `tickers.${symbol}`
        ]
      }));
    } catch (err) {
      console.error(`Error unsubscribing ${symbol}:`, err);
    }
  }

  subscribeAll() {
    this.subscribers.forEach((callbacks, symbol) => {
      this.sendSubscription(symbol);
    });
  }

  changeInterval(newInterval) {
    if (newInterval !== this.currentInterval) {
      this.connect(newInterval);
    }
  }

  disconnect() {
    this._stopThrottleTimer();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscribers.clear();
    this.messageBuffer.clear();
    this.isConnected = false;
  }

  /**
   * Obtiene estadísticas del WebSocket
   */
  getStats() {
    return {
      connected: this.isConnected,
      interval: this.currentInterval,
      subscriberCount: this.subscribers.size,
      bufferSize: this.messageBuffer.size,
      throttleMs: this.throttleMs,
      throttleEnabled: this.throttleEnabled
    };
  }
}

// Instancia única global
const wsManager = new WebSocketManager();
export default wsManager;
