/**
 * Robustness utilities for TradingBot Desktop
 * Health checks, validation, retry with backoff
 */

// Retry with exponential backoff
export async function retryWithBackoff(fn, maxRetries = 3, initialDelayMs = 1000) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const delay = initialDelayMs * Math.pow(2, attempt);
        console.warn(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// Health check for backend connection
export async function checkBackendHealth(baseUrl) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${baseUrl}/api/status`, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return {
        healthy: true,
        credentialsConfigured: data.credentials_configured,
        symbolsConfigured: data.symbols_configured,
        activeConnections: data.active_connections
      };
    }
    return { healthy: false, error: `HTTP ${response.status}` };
  } catch (error) {
    return {
      healthy: false,
      error: error.name === 'AbortError' ? 'Timeout' : error.message
    };
  }
}

// Validate WebSocket connection
export function createRobustWebSocket(url, options = {}) {
  const {
    onOpen,
    onMessage,
    onClose,
    onError,
    reconnectDelay = 3000,
    maxReconnectAttempts = 10,
    heartbeatInterval = 30000
  } = options;

  let ws = null;
  let reconnectAttempts = 0;
  let heartbeatTimer = null;
  let isDestroyed = false;

  function clearHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function startHeartbeat() {
    clearHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'ping' }));
        } catch (e) {
          console.warn('[WS] Heartbeat failed:', e.message);
        }
      }
    }, heartbeatInterval);
  }

  function connect() {
    if (isDestroyed) return;

    try {
      ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('[WS] Connected');
        reconnectAttempts = 0;
        startHeartbeat();
        if (onOpen) onOpen();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'pong') return; // Heartbeat response
          if (onMessage) onMessage(data);
        } catch (e) {
          console.warn('[WS] Failed to parse message:', e.message);
        }
      };

      ws.onclose = (event) => {
        console.log('[WS] Disconnected:', event.code, event.reason);
        clearHeartbeat();
        if (onClose) onClose(event);

        if (!isDestroyed && reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          const delay = reconnectDelay * Math.min(reconnectAttempts, 5);
          console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
          setTimeout(connect, delay);
        }
      };

      ws.onerror = (error) => {
        console.error('[WS] Error:', error);
        if (onError) onError(error);
      };
    } catch (error) {
      console.error('[WS] Failed to create WebSocket:', error);
      if (!isDestroyed && reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        setTimeout(connect, reconnectDelay);
      }
    }
  }

  function destroy() {
    isDestroyed = true;
    clearHeartbeat();
    if (ws) {
      ws.onclose = null; // Prevent reconnect
      ws.close();
      ws = null;
    }
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(typeof data === 'string' ? data : JSON.stringify(data));
      return true;
    }
    return false;
  }

  function isConnected() {
    return ws && ws.readyState === WebSocket.OPEN;
  }

  // Start connection
  connect();

  return {
    destroy,
    send,
    isConnected,
    reconnect: connect
  };
}

// Safe JSON parse
export function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// Debounce function
export function debounce(fn, delayMs) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delayMs);
  };
}

// Throttle function
export function throttle(fn, limitMs) {
  let inThrottle = false;
  return function (...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => { inThrottle = false; }, limitMs);
    }
  };
}

// Format error for display
export function formatError(error) {
  if (typeof error === 'string') return error;
  if (error?.message) return error.message;
  if (error?.detail) return error.detail;
  if (error?.error) return error.error;
  return 'Unknown error';
}

// Validate API response
export function validateApiResponse(response, requiredFields = []) {
  if (!response) {
    return { valid: false, error: 'Empty response' };
  }

  for (const field of requiredFields) {
    if (!(field in response)) {
      return { valid: false, error: `Missing field: ${field}` };
    }
  }

  return { valid: true };
}

// Connection status tracker
export class ConnectionTracker {
  constructor() {
    this.status = 'disconnected';
    this.lastConnected = null;
    this.lastError = null;
    this.listeners = new Set();
  }

  setConnected() {
    this.status = 'connected';
    this.lastConnected = new Date();
    this.lastError = null;
    this._notify();
  }

  setDisconnected(error = null) {
    this.status = 'disconnected';
    this.lastError = error;
    this._notify();
  }

  setConnecting() {
    this.status = 'connecting';
    this._notify();
  }

  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _notify() {
    this.listeners.forEach(cb => cb(this.status, this.lastError));
  }

  getStatus() {
    return {
      status: this.status,
      lastConnected: this.lastConnected,
      lastError: this.lastError
    };
  }
}

export default {
  retryWithBackoff,
  checkBackendHealth,
  createRobustWebSocket,
  safeJsonParse,
  debounce,
  throttle,
  formatError,
  validateApiResponse,
  ConnectionTracker
};
