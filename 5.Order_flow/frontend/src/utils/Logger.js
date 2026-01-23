/**
 * Logger - Sistema de logging condicional para eliminar console.log en producción
 *
 * Uso:
 * import Logger from './utils/Logger';
 * const log = new Logger('ComponentName');
 * log.info('mensaje');
 * log.error('error');
 */

class Logger {
  constructor(context = 'App', options = {}) {
    this.context = context;
    this.enabled = this.shouldBeEnabled(options);
    this.logLevel = options.level || 'info';
    this.useEmoji = options.emoji !== false;

    // Niveles de log
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4
    };
  }

  /**
   * Determina si el logger debe estar activo
   */
  shouldBeEnabled(options) {
    // Prioridad: opción específica > localStorage > entorno
    if (options.forceEnable !== undefined) {
      return options.forceEnable;
    }

    // Check localStorage para debug mode
    if (typeof window !== 'undefined') {
      const debugMode = localStorage.getItem('DEBUG_MODE');
      if (debugMode === 'true') return true;
      if (debugMode === 'false') return false;
    }

    // En desarrollo siempre activo, en producción desactivado
    return process.env.NODE_ENV === 'development';
  }

  /**
   * Formatea el mensaje con contexto y timestamp
   */
  format(level, message, ...args) {
    const timestamp = new Date().toLocaleTimeString('es-CO');
    const emoji = this.getEmoji(level);
    const prefix = this.useEmoji ? emoji : `[${level.toUpperCase()}]`;

    return [`${prefix} [${timestamp}] [${this.context}] ${message}`, ...args];
  }

  /**
   * Obtiene emoji según el nivel
   */
  getEmoji(level) {
    const emojis = {
      error: '❌',
      warn: '⚠️',
      info: '✅',
      debug: '🔍',
      trace: '📍'
    };
    return emojis[level] || '📝';
  }

  /**
   * Verifica si debe loggear según el nivel
   */
  shouldLog(level) {
    if (!this.enabled) return false;

    const currentLevel = this.levels[this.logLevel] || 2;
    const messageLevel = this.levels[level] || 2;

    return messageLevel <= currentLevel;
  }

  // Métodos de logging
  error(message, ...args) {
    if (this.shouldLog('error')) {
      console.error(...this.format('error', message, ...args));
    }
  }

  warn(message, ...args) {
    if (this.shouldLog('warn')) {
      console.warn(...this.format('warn', message, ...args));
    }
  }

  info(message, ...args) {
    if (this.shouldLog('info')) {
      console.log(...this.format('info', message, ...args));
    }
  }

  debug(message, ...args) {
    if (this.shouldLog('debug')) {
      console.log(...this.format('debug', message, ...args));
    }
  }

  trace(message, ...args) {
    if (this.shouldLog('trace')) {
      console.log(...this.format('trace', message, ...args));
    }
  }

  // Alias para compatibilidad
  log(message, ...args) {
    this.info(message, ...args);
  }

  // Método para alertas importantes (siempre visible)
  alert(message, ...args) {
    // Las alertas siempre se muestran, independientemente del nivel de log
    const timestamp = new Date().toLocaleTimeString('es-CO');
    console.log(`%c🚨 [${timestamp}] [${this.context}] ${message}`, 'color: #FF5722; font-weight: bold', ...args);
  }

  // Método para medir tiempo
  time(label) {
    if (this.enabled) {
      console.time(`[${this.context}] ${label}`);
    }
  }

  timeEnd(label) {
    if (this.enabled) {
      console.timeEnd(`[${this.context}] ${label}`);
    }
  }

  // Método para tablas
  table(data) {
    if (this.enabled) {
      console.log(`[${this.context}] Table:`);
      console.table(data);
    }
  }

  // Método para grupos
  group(label) {
    if (this.enabled) {
      console.group(`[${this.context}] ${label}`);
    }
  }

  groupEnd() {
    if (this.enabled) {
      console.groupEnd();
    }
  }

  // Método para limpiar consola
  clear() {
    if (this.enabled) {
      console.clear();
    }
  }
}

// Singleton global para configuración
class LoggerConfig {
  static instance = null;

  constructor() {
    if (LoggerConfig.instance) {
      return LoggerConfig.instance;
    }

    this.globalEnabled = process.env.NODE_ENV === 'development';
    this.contexts = new Map(); // Configuración por contexto

    LoggerConfig.instance = this;
  }

  static getInstance() {
    if (!LoggerConfig.instance) {
      LoggerConfig.instance = new LoggerConfig();
    }
    return LoggerConfig.instance;
  }

  // Habilitar/deshabilitar logging globalmente
  setGlobalEnabled(enabled) {
    this.globalEnabled = enabled;
    if (typeof window !== 'undefined') {
      localStorage.setItem('DEBUG_MODE', enabled ? 'true' : 'false');
    }
  }

  // Habilitar/deshabilitar contextos específicos
  setContextEnabled(context, enabled) {
    this.contexts.set(context, enabled);
  }

  isContextEnabled(context) {
    if (!this.globalEnabled) return false;
    if (this.contexts.has(context)) {
      return this.contexts.get(context);
    }
    return true;
  }

  // Método de utilidad para deshabilitar logs pesados
  disableHeavyLogs() {
    const heavyContexts = [
      'WebSocket',
      'IndicatorManager',
      'DoubleTopBottom',
      'VWAP',
      'RejectionPattern',
      'VolumeProfile'
    ];

    heavyContexts.forEach(ctx => {
      this.setContextEnabled(ctx, false);
    });

    console.log('🔇 Heavy logs disabled. Contexts:', heavyContexts);
  }

  // Método para obtener estadísticas
  getStats() {
    return {
      globalEnabled: this.globalEnabled,
      contexts: Array.from(this.contexts.entries())
    };
  }
}

// Exportar tanto la clase como la instancia de configuración
export default Logger;
export { LoggerConfig };

// Función de utilidad para crear logger rápidamente
export function createLogger(context, options) {
  return new Logger(context, options);
}

// Función global para toggle debug mode
if (typeof window !== 'undefined') {
  window.toggleDebugMode = () => {
    const config = LoggerConfig.getInstance();
    const currentState = localStorage.getItem('DEBUG_MODE') === 'true';
    config.setGlobalEnabled(!currentState);
    console.log(`🔧 Debug mode: ${!currentState ? 'ENABLED' : 'DISABLED'}`);
    return !currentState;
  };

  window.disableHeavyLogs = () => {
    const config = LoggerConfig.getInstance();
    config.disableHeavyLogs();
  };

  // Mostrar estado al cargar
  if (process.env.NODE_ENV === 'development') {
    console.log('💡 Debug utilities available:');
    console.log('   window.toggleDebugMode() - Toggle all logs');
    console.log('   window.disableHeavyLogs() - Disable performance-heavy logs');
  }
}