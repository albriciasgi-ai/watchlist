/**
 * Una sola conexion al WebSocket publico de Bybit para todos los graficos en vivo.
 *
 * Cada suscripcion es por moneda Y marco (`kline.{marco}.{moneda}`): varios graficos de la misma moneda en
 * marcos distintos (la suite tiene un MiniChart por marco) reciben cada uno solo sus velas. Antes la conexion
 * tenia un solo marco: el ultimo grafico en conectarse lo cambiaba para todos, y al de 1m le llegaban las
 * velas de 15m. Los tickers van por moneda y se reparten a todos sus graficos.
 *
 * Envia ping cada 20 s (Bybit corta una conexion sin ping) y al reconectar vuelve a suscribir todo.
 */
const WS_URL = 'wss://stream.bybit.com/v5/public/linear';
const PING_MS = 20000;
const RECONNECT_MS = 3000;

const keyOf = (symbol, interval) => `${interval}|${symbol}`;

class WebSocketManager {
  constructor() {
    this.ws = null;
    this.subscribers = new Map(); // "marco|moneda" -> Set(callback)
    this.isConnected = false;
    this.reconnectTimeout = null;
    this.pingTimer = null;
    this.currentInterval = "15"; // marco por defecto de subscribe() sin marco (compatibilidad)
    this.closing = false;
  }

  /** Abre la conexion si no esta abierta. El marco solo queda como el de subscribe() sin marco */
  connect(interval) {
    if (interval) this.currentInterval = String(interval);
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closing = false;
    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      this.isConnected = true;
      // Bybit necesita un momento antes de aceptar suscripciones
      setTimeout(() => this.subscribeAll(), 100);
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        try {
          if (ws.readyState === WebSocket.OPEN) ws.send('{"op":"ping"}');
        } catch {
          // la reconexion se encarga
        }
      }, PING_MS);
    };

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
        return;
      }
      if (!data.topic) return;
      if (data.topic.startsWith('kline.')) {
        const [, interval, symbol] = data.topic.split('.');
        this._dispatch(this.subscribers.get(keyOf(symbol, interval)), data);
      } else if (data.topic.startsWith('tickers.')) {
        const symbol = data.topic.slice('tickers.'.length);
        this.subscribers.forEach((callbacks, key) => {
          if (key.endsWith(`|${symbol}`)) this._dispatch(callbacks, data);
        });
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket Manager error:', error);
    };

    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
        this.isConnected = false;
      }
      clearInterval(this.pingTimer);
      if (this.closing || this.subscribers.size === 0) return;
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = setTimeout(() => this.connect(), RECONNECT_MS);
    };
  }

  _dispatch(callbacks, data) {
    if (!callbacks) return;
    callbacks.forEach(cb => {
      try {
        cb(data);
      } catch (err) {
        console.error('Error en un suscriptor del WebSocket:', err);
      }
    });
  }

  /** Recibe las velas de `symbol` en `interval` (marco de Bybit: "1", "5", "15", "60", "240"...) y su ticker */
  subscribe(symbol, callback, interval = this.currentInterval) {
    const key = keyOf(symbol, String(interval));
    const isNew = !this.subscribers.has(key);
    if (isNew) this.subscribers.set(key, new Set());
    this.subscribers.get(key).add(callback);
    if (!this.ws) this.connect();
    else if (isNew && this.isConnected) this._send('subscribe', this._topics(symbol, String(interval)));
  }

  unsubscribe(symbol, callback, interval = null) {
    const keys = interval !== null ? [keyOf(symbol, String(interval))]
      : [...this.subscribers.keys()].filter(key => key.endsWith(`|${symbol}`));
    keys.forEach(key => {
      const callbacks = this.subscribers.get(key);
      if (!callbacks) return;
      callbacks.delete(callback);
      if (callbacks.size > 0) return;
      this.subscribers.delete(key);
      if (this.isConnected) {
        const [iv] = key.split('|');
        const topics = [`kline.${iv}.${symbol}`];
        // El ticker se deja de recibir solo si ningun marco de la moneda lo usa
        if (![...this.subscribers.keys()].some(k => k.endsWith(`|${symbol}`))) topics.push(`tickers.${symbol}`);
        this._send('unsubscribe', topics);
      }
    });
  }

  _topics(symbol, interval) {
    return [`kline.${interval}.${symbol}`, `tickers.${symbol}`];
  }

  _send(op, args) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !args.length) return;
    try {
      this.ws.send(JSON.stringify({ op, args }));
    } catch (err) {
      console.error(`Error en ${op} de ${args.join(', ')}:`, err);
    }
  }

  subscribeAll() {
    const topics = new Set();
    this.subscribers.forEach((callbacks, key) => {
      const [interval, symbol] = key.split('|');
      this._topics(symbol, interval).forEach(t => topics.add(t));
    });
    const list = [...topics];
    // Bybit acepta hasta 10 temas por mensaje
    for (let i = 0; i < list.length; i += 10) this._send('subscribe', list.slice(i, i + 10));
  }

  /** Compatibilidad: solo cambia el marco por defecto; cada suscripcion ya lleva el suyo */
  changeInterval(newInterval) {
    this.currentInterval = String(newInterval);
    this.connect();
  }

  disconnect() {
    this.closing = true;
    clearTimeout(this.reconnectTimeout);
    clearInterval(this.pingTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscribers.clear();
    this.isConnected = false;
  }
}

// Instancia unica global
const wsManager = new WebSocketManager();
export default wsManager;
