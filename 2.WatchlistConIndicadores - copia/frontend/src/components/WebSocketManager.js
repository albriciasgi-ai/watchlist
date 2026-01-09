class WebSocketManager {
  constructor() {
    this.ws = null;
    this.subscribers = new Map();
    this.isConnected = false;
    this.reconnectTimeout = null;
    this.currentInterval = "15";
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
      
      // Esperar 100ms antes de suscribir (Bybit necesita tiempo)
      setTimeout(() => {
        this.subscribeAll();
      }, 100);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Log de respuesta de suscripciÃ³n
        if (data.op === "subscribe" && data.success) {
          console.log(`âœ“ Suscrito:`, data.ret_msg);
        }
        
        if (data.topic) {
          // Extraer sÃ­mbolo del topic
          let symbol = null;
          if (data.topic.startsWith('tickers.')) {
            symbol = data.topic.replace('tickers.', '');
          } else if (data.topic.startsWith('kline.')) {
            const parts = data.topic.split('.');
            symbol = parts[2];
          }

          if (symbol && this.subscribers.has(symbol)) {
            const callbacks = this.subscribers.get(symbol);
            callbacks.forEach(cb => cb(data));
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
      
      // Reconectar despuÃ©s de 3 segundos
      this.reconnectTimeout = setTimeout(() => {
        this.connect(this.currentInterval);
      }, 3000);
    };
  }

  subscribe(symbol, callback) {
    if (!this.subscribers.has(symbol)) {
      this.subscribers.set(symbol, new Set());
    }
    this.subscribers.get(symbol).add(callback);

    // Si ya estÃ¡ conectado, suscribir inmediatamente
    if (this.isConnected && this.ws) {
      this.sendSubscription(symbol);
    }
  }

  unsubscribe(symbol, callback) {
    if (this.subscribers.has(symbol)) {
      this.subscribers.get(symbol).delete(callback);
      if (this.subscribers.get(symbol).size === 0) {
        this.subscribers.delete(symbol);
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
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscribers.clear();
    this.isConnected = false;
  }
}

// Instancia Ãºnica global
const wsManager = new WebSocketManager();
export default wsManager;