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

    // Reconexión y latido
    this._reconnectAttempts = 0;
    this._heartbeatTimer = null;
    this._lastMessageAt = 0;

    // Tras un corte, los gráficos recargan su histórico: las velas que cerraron durante el corte
    // nunca llegan por el WebSocket y la vela en curso guardada quedó vieja
    this._reconnectListeners = new Set();
    this._hadDrop = false;

    // Al volver la red (p. ej. al despertar el portátil) reconectar sin esperar
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', () => {
        if (!this.isConnected && this.subscribers.size > 0) {
          console.log('[WebSocketManager] Red disponible de nuevo: reconectando');
          if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
          }
          this._reconnectAttempts = 0;
          this._hadDrop = true;
          if (this.ws) {
            const oldSocket = this.ws;
            this.ws = null;
            try { oldSocket.close(); } catch (_) { /* ya cerrado */ }
          }
          this.connect(this.currentInterval);
        }
      });
    }
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

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      // Se suelta antes de cerrarlo: su onclose ya no reconecta (ver comprobación de identidad)
      const oldSocket = this.ws;
      this.ws = null;
      try { oldSocket.close(); } catch (_) { /* ya cerrado */ }
    }
    this._stopHeartbeat();

    const wsUrl = 'wss://stream.bybit.com/v5/public/linear';
    const socket = new WebSocket(wsUrl);
    this.ws = socket;
    this._lastMessageAt = Date.now();

    socket.onopen = () => {
      if (this.ws !== socket) return;
      console.log(`WebSocket Manager conectado [${interval}]`);
      this.isConnected = true;
      this._reconnectAttempts = 0;
      this._lastMessageAt = Date.now();

      // Iniciar timer de throttle
      this._startThrottleTimer();
      // Ping cada 20 s, como pide Bybit, y vigilancia de conexión muerta
      this._startHeartbeat(socket);

      if (this._hadDrop) {
        this._hadDrop = false;
        this._notifyReconnect();
      }

      // Esperar 100ms antes de suscribir (Bybit necesita tiempo)
      setTimeout(() => {
        if (this.ws === socket) this.subscribeAll();
      }, 100);
    };

    socket.onmessage = (event) => {
      // Mensajes rezagados de un socket ya reemplazado (otro intervalo) se ignoran
      if (this.ws !== socket) return;
      this._lastMessageAt = Date.now();
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
              const bucket = this.messageBuffer.get(symbol);
              if (messageType === 'kline' && bucket.kline) {
                // El mensaje que cierra una vela (confirm) no se pisa con el primero de la siguiente:
                // se entrega ya. Antes se perdía y la vela quedaba con datos a medias.
                const prev = bucket.kline.data && bucket.kline.data[0];
                const next = data.data && data.data[0];
                if (prev && next && prev.confirm && String(prev.start) !== String(next.start)) {
                  this._dispatchToSubscribers(symbol, bucket.kline);
                }
              }
              bucket[messageType] = data;
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

    socket.onerror = (error) => {
      console.error('WebSocket Manager error:', error);
    };

    socket.onclose = () => {
      // Solo el socket vigente reconecta: uno reemplazado (cambio de intervalo) o cerrado
      // con disconnect() no debe abrir otro
      if (this.ws !== socket) return;
      console.log('WebSocket Manager cerrado');
      this._handleDrop();
    };
  }

  /**
   * Conexión perdida: reconecta a los 3 s (hasta 30 s si sigue fallando).
   * Antes this.ws seguía apuntando al socket cerrado y connect() salía sin reconectar:
   * la vela en vivo quedaba congelada hasta cambiar de timeframe.
   */
  _handleDrop() {
    this.ws = null;
    this.isConnected = false;
    this._hadDrop = true;
    this._stopThrottleTimer();
    this._stopHeartbeat();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    const attempts = this._reconnectAttempts || 0;
    const delay = Math.min(30000, 3000 * Math.pow(2, attempts));
    this._reconnectAttempts = attempts + 1;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (!this.ws) {
        this.connect(this.currentInterval);
      }
    }, delay);
  }

  /**
   * Ping cada 20 s y, si no llega nada en 60 s (red caída o portátil suspendido),
   * se da la conexión por muerta y se reconecta.
   */
  _startHeartbeat(socket) {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this.ws !== socket) {
        this._stopHeartbeat();
        return;
      }
      if (Date.now() - (this._lastMessageAt || 0) > 60000) {
        console.warn('[WebSocketManager] Sin datos en 60 s: reconectando');
        try { socket.close(); } catch (_) { /* ya cerrado */ }
        this._handleDrop();
        return;
      }
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify({ op: 'ping' }));
        } catch (_) { /* se detecta en la próxima vuelta */ }
      }
    }, 20000);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
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

  /**
   * Avisa cuando el WebSocket vuelve después de un corte. Devuelve la función para dejar de escuchar.
   */
  onReconnect(callback) {
    this._reconnectListeners.add(callback);
    return () => this._reconnectListeners.delete(callback);
  }

  _notifyReconnect() {
    console.log(`[WebSocketManager] Reconectado: ${this._reconnectListeners.size} gráfico(s) recargan su histórico`);
    this._reconnectListeners.forEach(cb => {
      try {
        cb();
      } catch (err) {
        console.error('Error in reconnect callback:', err);
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
    this._stopHeartbeat();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.close();
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
