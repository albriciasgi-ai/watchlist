/**
 * Robustness utilities for TradingJournal Desktop
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

    const response = await fetch(`${baseUrl}/api/monitor/status`, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return {
        healthy: true,
        running: data.running,
        trackedPositions: data.tracked_positions,
        pollInterval: data.poll_interval
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

// Check Trading Bot connection
export async function checkTradingBotConnection(tradingBotUrl = 'http://localhost:5000') {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${tradingBotUrl}/api/status`, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    return {
      connected: response.ok,
      error: response.ok ? null : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      connected: false,
      error: error.name === 'AbortError' ? 'Timeout' : error.message
    };
  }
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

// Format currency value
export function formatCurrency(value) {
  if (value === null || value === undefined) return '$0.00';
  const num = parseFloat(value);
  const sign = num >= 0 ? '+' : '';
  return `${sign}$${Math.abs(num).toFixed(2)}`;
}

// Format percentage value
export function formatPercent(value) {
  if (value === null || value === undefined) return '0.0%';
  const num = parseFloat(value);
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(1)}%`;
}

// Format R-multiple
export function formatR(value) {
  if (value === null || value === undefined) return '0.00R';
  const num = parseFloat(value);
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}R`;
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
  checkTradingBotConnection,
  safeJsonParse,
  debounce,
  throttle,
  formatError,
  validateApiResponse,
  formatCurrency,
  formatPercent,
  formatR,
  ConnectionTracker
};
