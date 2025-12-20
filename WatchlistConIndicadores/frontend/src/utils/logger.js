/**
 * Sistema de logging con niveles configurables
 *
 * Niveles de log:
 * - ERROR: Errores críticos (siempre se muestran)
 * - WARN: Advertencias importantes (siempre se muestran)
 * - INFO: Información importante (alertas, eventos clave)
 * - DEBUG: Información de depuración detallada (oculta por defecto)
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

// ✅ Configuración: Cambiar a LOG_LEVELS.DEBUG para ver todos los logs
const CURRENT_LOG_LEVEL = LOG_LEVELS.INFO;

// ✅ Categorías específicas que siempre se muestran (incluso si DEBUG está desactivado)
const ALWAYS_SHOW_CATEGORIES = [
  'ALERT',      // Sistema de alertas
  'PATTERN',    // Detección de patrones
  'ERROR'       // Errores
];

class Logger {
  constructor(context = '') {
    this.context = context;
  }

  _shouldLog(level, category = '') {
    // Siempre mostrar errores y warnings
    if (level <= LOG_LEVELS.WARN) return true;

    // Siempre mostrar categorías importantes
    if (category && ALWAYS_SHOW_CATEGORIES.includes(category.toUpperCase())) {
      return true;
    }

    // Para otros logs, verificar nivel
    return level <= CURRENT_LOG_LEVEL;
  }

  _formatMessage(level, category, message, data) {
    const timestamp = new Date().toLocaleTimeString();
    const levelIcon = {
      [LOG_LEVELS.ERROR]: '❌',
      [LOG_LEVELS.WARN]: '⚠️',
      [LOG_LEVELS.INFO]: 'ℹ️',
      [LOG_LEVELS.DEBUG]: '🔍'
    }[level] || '';

    const categoryStr = category ? `[${category}]` : '';
    const contextStr = this.context ? `[${this.context}]` : '';

    return `${levelIcon} ${timestamp} ${contextStr}${categoryStr} ${message}`;
  }

  error(message, data = null) {
    const formatted = this._formatMessage(LOG_LEVELS.ERROR, 'ERROR', message, data);
    if (data) {
      console.error(formatted, data);
    } else {
      console.error(formatted);
    }
  }

  warn(message, data = null) {
    if (!this._shouldLog(LOG_LEVELS.WARN)) return;

    const formatted = this._formatMessage(LOG_LEVELS.WARN, '', message, data);
    if (data) {
      console.warn(formatted, data);
    } else {
      console.warn(formatted);
    }
  }

  info(message, data = null) {
    if (!this._shouldLog(LOG_LEVELS.INFO)) return;

    const formatted = this._formatMessage(LOG_LEVELS.INFO, '', message, data);
    if (data) {
      console.log(formatted, data);
    } else {
      console.log(formatted);
    }
  }

  debug(message, data = null) {
    if (!this._shouldLog(LOG_LEVELS.DEBUG)) return;

    const formatted = this._formatMessage(LOG_LEVELS.DEBUG, '', message, data);
    if (data) {
      console.log(formatted, data);
    } else {
      console.log(formatted);
    }
  }

  // ✅ Métodos especiales para categorías importantes (siempre se muestran)
  alert(message, data = null) {
    const formatted = this._formatMessage(LOG_LEVELS.INFO, 'ALERT', message, data);
    if (data) {
      console.log(formatted, data);
    } else {
      console.log(formatted);
    }
  }

  pattern(message, data = null) {
    const formatted = this._formatMessage(LOG_LEVELS.INFO, 'PATTERN', message, data);
    if (data) {
      console.log(formatted, data);
    } else {
      console.log(formatted);
    }
  }
}

// Factory function para crear loggers con contexto
export const createLogger = (context) => new Logger(context);

// Logger global por defecto
export const logger = new Logger();

export default logger;
