/**
 * ConfigSynchronizer - Synchronizes indicator configs and calculated levels to backend
 *
 * This module ensures the backend has the same configuration and calculated levels
 * as the frontend, enabling identical pattern detection in real-time.
 *
 * Author: Claude Code
 * Date: 2025-01-16
 */

import { API_BASE_URL } from '../config.js';

class ConfigSynchronizer {
  constructor() {
    this.pendingSync = new Map(); // symbol_interval_type -> timeout
    this.debounceMs = 500; // Debounce multiple rapid changes
    this.lastSyncTime = new Map(); // Track last sync per key
    this.syncErrors = new Map(); // Track errors for retry logic
    this.maxRetries = 3;

    console.log('[ConfigSynchronizer] Initialized');
  }

  /**
   * Generate a unique key for sync tracking
   */
  _getKey(symbol, interval, indicatorType) {
    return `${symbol}_${interval}_${indicatorType}`;
  }

  /**
   * Sync indicator configuration to backend
   *
   * @param {string} symbol - Trading pair (e.g., "BTCUSDT")
   * @param {string} interval - Timeframe (e.g., "240")
   * @param {string} indicatorType - "doubleTopBottom" or "rejection"
   * @param {Object} config - Full indicator configuration
   * @param {Object} calculatedLevels - Optional calculated levels (VWAP, S/R, etc.)
   */
  syncConfig(symbol, interval, indicatorType, config, calculatedLevels = null) {
    const key = this._getKey(symbol, interval, indicatorType);

    // Clear any pending sync for this key
    if (this.pendingSync.has(key)) {
      clearTimeout(this.pendingSync.get(key));
    }

    // Debounce: wait before actually syncing
    const timeout = setTimeout(() => {
      this._doSync(symbol, interval, indicatorType, config, calculatedLevels);
      this.pendingSync.delete(key);
    }, this.debounceMs);

    this.pendingSync.set(key, timeout);
  }

  /**
   * Sync only calculated levels (for frequent updates like VWAP)
   *
   * @param {string} symbol - Trading pair
   * @param {string} interval - Timeframe
   * @param {Object} levels - Calculated levels object
   */
  syncLevels(symbol, interval, levels) {
    // Sync to both indicator types since levels are shared
    this._doSyncLevels(symbol, interval, 'doubleTopBottom', levels);
    this._doSyncLevels(symbol, interval, 'rejection', levels);
  }

  /**
   * Internal method to perform the actual sync
   */
  async _doSync(symbol, interval, indicatorType, config, calculatedLevels) {
    const key = this._getKey(symbol, interval, indicatorType);

    try {
      const payload = {
        interval,
        indicatorType,
        config
      };

      if (calculatedLevels) {
        payload.calculatedLevels = calculatedLevels;
      }

      const response = await fetch(`${API_BASE_URL}/api/realtime/config/${symbol}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (result.success) {
        this.lastSyncTime.set(key, Date.now());
        this.syncErrors.delete(key); // Clear any previous errors
        console.log(`[ConfigSynchronizer] Synced ${symbol}/${interval}/${indicatorType}`);
      } else {
        console.warn(`[ConfigSynchronizer] Sync failed for ${key}:`, result.error);
        this._handleSyncError(key, symbol, interval, indicatorType, config, calculatedLevels);
      }
    } catch (error) {
      console.warn(`[ConfigSynchronizer] Sync error for ${key}:`, error.message);
      this._handleSyncError(key, symbol, interval, indicatorType, config, calculatedLevels);
    }
  }

  /**
   * Internal method to sync only levels
   */
  async _doSyncLevels(symbol, interval, indicatorType, levels) {
    try {
      const payload = {
        interval,
        indicatorType,
        calculatedLevels: levels
      };

      await fetch(`${API_BASE_URL}/api/realtime/config/${symbol}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      // Don't log every level sync to avoid spam
    } catch (error) {
      // Silently fail for level syncs - they'll be retried on next update
    }
  }

  /**
   * Handle sync errors with retry logic
   */
  _handleSyncError(key, symbol, interval, indicatorType, config, calculatedLevels) {
    const errorCount = (this.syncErrors.get(key) || 0) + 1;
    this.syncErrors.set(key, errorCount);

    if (errorCount < this.maxRetries) {
      // Retry with exponential backoff
      const delay = Math.pow(2, errorCount) * 1000;
      console.log(`[ConfigSynchronizer] Retrying ${key} in ${delay}ms (attempt ${errorCount})`);

      setTimeout(() => {
        this._doSync(symbol, interval, indicatorType, config, calculatedLevels);
      }, delay);
    } else {
      console.error(`[ConfigSynchronizer] Max retries reached for ${key}`);
    }
  }

  /**
   * Force immediate sync (bypass debounce)
   */
  async forcSync(symbol, interval, indicatorType, config, calculatedLevels = null) {
    const key = this._getKey(symbol, interval, indicatorType);

    // Clear any pending debounced sync
    if (this.pendingSync.has(key)) {
      clearTimeout(this.pendingSync.get(key));
      this.pendingSync.delete(key);
    }

    await this._doSync(symbol, interval, indicatorType, config, calculatedLevels);
  }

  /**
   * Get sync status for debugging
   */
  getStatus() {
    return {
      pendingSyncs: this.pendingSync.size,
      lastSyncTimes: Object.fromEntries(this.lastSyncTime),
      errors: Object.fromEntries(this.syncErrors)
    };
  }

  /**
   * Check if backend realtime service is available
   */
  async checkBackendStatus() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/realtime/status`);
      const result = await response.json();
      return result;
    } catch (error) {
      return {
        success: false,
        running: false,
        error: error.message
      };
    }
  }
}

// Singleton instance
const configSynchronizer = new ConfigSynchronizer();

export default configSynchronizer;

// Named exports for convenience
export const syncConfig = (symbol, interval, indicatorType, config, calculatedLevels) => {
  configSynchronizer.syncConfig(symbol, interval, indicatorType, config, calculatedLevels);
};

export const syncLevels = (symbol, interval, levels) => {
  configSynchronizer.syncLevels(symbol, interval, levels);
};

export const forceSync = async (symbol, interval, indicatorType, config, calculatedLevels) => {
  await configSynchronizer.forcSync(symbol, interval, indicatorType, config, calculatedLevels);
};

export const getBackendStatus = async () => {
  return await configSynchronizer.checkBackendStatus();
};
