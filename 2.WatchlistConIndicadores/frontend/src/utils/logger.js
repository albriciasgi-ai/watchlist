/**
 * Logger utility for indicators and components
 * Provides context-aware logging with symbol prefix
 */

// Log levels
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  alert: 4
};

// Default log level (can be adjusted in production)
const DEFAULT_LOG_LEVEL = process.env.NODE_ENV === 'production' ? 'warn' : 'debug';

/**
 * Creates a logger instance with the given context (symbol)
 * @param {string} context - The context/symbol for the logger
 * @returns {object} Logger instance with debug, info, warn, error, alert methods
 */
export const createLogger = (context = 'App') => {
  const currentLevel = LOG_LEVELS[DEFAULT_LOG_LEVEL] || 0;
  const prefix = `[${context}]`;

  return {
    debug: (...args) => {
      if (currentLevel <= LOG_LEVELS.debug) {
        console.debug(prefix, ...args);
      }
    },
    info: (...args) => {
      if (currentLevel <= LOG_LEVELS.info) {
        console.info(prefix, ...args);
      }
    },
    warn: (...args) => {
      if (currentLevel <= LOG_LEVELS.warn) {
        console.warn(prefix, ...args);
      }
    },
    error: (...args) => {
      if (currentLevel <= LOG_LEVELS.error) {
        console.error(prefix, ...args);
      }
    },
    alert: (...args) => {
      // Alert is always shown - used for critical pattern notifications
      console.log('%c' + prefix, 'color: #FF5722; font-weight: bold', ...args);
    }
  };
};

export default createLogger;
