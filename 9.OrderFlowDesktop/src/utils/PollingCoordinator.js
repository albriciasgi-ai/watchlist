// src/utils/PollingCoordinator.js
// ✅ OPTIMIZACION v2: Coordinador eficiente para polling de indicadores
// Usa timers individuales en lugar de tick global para evitar overhead

/**
 * PollingCoordinator v2 - Coordina el polling de multiples indicadores
 *
 * Mejoras sobre v1:
 * - Usa setTimeout individual por callback (no tick global cada 1s)
 * - Respeta visibilidad del tab (pausa cuando oculto)
 * - Evita solapamiento de ejecuciones async
 * - Sin overhead cuando esta idle
 */
class PollingCoordinator {
  constructor() {
    // Callbacks registrados: Map<id, CallbackEntry>
    this._callbacks = new Map();

    // Estado global
    this._isRunning = false;
    this._isPaused = false;

    // Listener de visibilidad
    this._visibilityHandler = this._onVisibilityChange.bind(this);

    // Contador para IDs unicos
    this._idCounter = 0;
  }

  /**
   * Inicia el coordinator
   */
  start() {
    if (this._isRunning) return;

    this._isRunning = true;
    this._isPaused = document.visibilityState === 'hidden';

    // Escuchar cambios de visibilidad
    document.addEventListener('visibilitychange', this._visibilityHandler);

    // Iniciar timers de callbacks existentes
    for (const [id, entry] of this._callbacks) {
      if (entry.enabled && !this._isPaused) {
        this._scheduleNext(id, entry);
      }
    }

    console.log('[PollingCoordinator] Started');
  }

  /**
   * Detiene el coordinator
   */
  stop() {
    if (!this._isRunning) return;

    this._isRunning = false;

    // Remover listener
    document.removeEventListener('visibilitychange', this._visibilityHandler);

    // Cancelar todos los timers
    for (const [id, entry] of this._callbacks) {
      if (entry.timerId) {
        clearTimeout(entry.timerId);
        entry.timerId = null;
      }
    }

    console.log('[PollingCoordinator] Stopped');
  }

  /**
   * Registra un callback para polling
   * @param {string} name - Nombre descriptivo (para logs)
   * @param {Function} callback - Funcion a ejecutar (puede ser async)
   * @param {number} intervalMs - Intervalo en milisegundos
   * @param {number} priority - Prioridad (no usado en v2, mantenido por compatibilidad)
   * @returns {string} ID del registro para poder cancelar
   */
  register(name, callback, intervalMs, priority = 5) {
    const id = `poll_${++this._idCounter}_${name.replace(/\s+/g, '_')}`;

    const entry = {
      name,
      callback,
      intervalMs,
      priority,
      enabled: true,
      isRunning: false,  // Evita solapamiento
      timerId: null
    };

    this._callbacks.set(id, entry);

    // Si el coordinator ya esta corriendo, iniciar el timer
    if (this._isRunning && !this._isPaused) {
      this._scheduleNext(id, entry);
    }

    console.log(`[PollingCoordinator] Registered: ${name} (interval: ${intervalMs}ms, priority: ${priority})`);
    return id;
  }

  /**
   * Cancela un callback registrado
   * @param {string} id - ID retornado por register()
   */
  unregister(id) {
    const entry = this._callbacks.get(id);
    if (entry) {
      // Cancelar timer pendiente
      if (entry.timerId) {
        clearTimeout(entry.timerId);
      }
      console.log(`[PollingCoordinator] Unregistered: ${entry.name}`);
      this._callbacks.delete(id);
    }
  }

  /**
   * Pausa un callback especifico
   */
  pause(id) {
    const entry = this._callbacks.get(id);
    if (entry) {
      entry.enabled = false;
      if (entry.timerId) {
        clearTimeout(entry.timerId);
        entry.timerId = null;
      }
      console.log(`[PollingCoordinator] Paused: ${entry.name}`);
    }
  }

  /**
   * Reanuda un callback especifico
   */
  resume(id) {
    const entry = this._callbacks.get(id);
    if (entry && !entry.enabled) {
      entry.enabled = true;
      if (this._isRunning && !this._isPaused) {
        this._scheduleNext(id, entry);
      }
      console.log(`[PollingCoordinator] Resumed: ${entry.name}`);
    }
  }

  /**
   * Pausa todo el coordinator
   */
  pauseAll() {
    this._isPaused = true;
    // Cancelar todos los timers
    for (const [id, entry] of this._callbacks) {
      if (entry.timerId) {
        clearTimeout(entry.timerId);
        entry.timerId = null;
      }
    }
    console.log('[PollingCoordinator] All paused');
  }

  /**
   * Reanuda todo el coordinator
   */
  resumeAll() {
    this._isPaused = false;
    // Reiniciar timers
    for (const [id, entry] of this._callbacks) {
      if (entry.enabled && !entry.timerId && !entry.isRunning) {
        this._scheduleNext(id, entry);
      }
    }
    console.log('[PollingCoordinator] All resumed');
  }

  /**
   * Programa la proxima ejecucion de un callback
   */
  _scheduleNext(id, entry) {
    if (!this._isRunning || this._isPaused || !entry.enabled) {
      return;
    }

    // Cancelar timer anterior si existe
    if (entry.timerId) {
      clearTimeout(entry.timerId);
    }

    entry.timerId = setTimeout(() => {
      this._executeCallback(id, entry);
    }, entry.intervalMs);
  }

  /**
   * Ejecuta un callback y programa el siguiente
   */
  async _executeCallback(id, entry) {
    // Verificar que aun existe y esta habilitado
    if (!this._callbacks.has(id) || !entry.enabled || this._isPaused) {
      console.log(`[PollingCoordinator] Skipping ${entry.name}: exists=${this._callbacks.has(id)}, enabled=${entry.enabled}, paused=${this._isPaused}`);
      return;
    }

    // Evitar solapamiento - si ya esta corriendo, reprogramar
    if (entry.isRunning) {
      console.log(`[PollingCoordinator] ${entry.name} already running, rescheduling`);
      this._scheduleNext(id, entry);
      return;
    }

    entry.isRunning = true;
    entry.timerId = null;

    console.log(`[PollingCoordinator] Executing: ${entry.name}`);

    try {
      const result = entry.callback();

      // Esperar si es promesa
      if (result instanceof Promise) {
        await result;
      }
      console.log(`[PollingCoordinator] Completed: ${entry.name}`);
    } catch (err) {
      console.error(`[PollingCoordinator] Error in ${entry.name}:`, err);
    } finally {
      entry.isRunning = false;

      // Programar siguiente ejecucion (si aun esta registrado y habilitado)
      if (this._callbacks.has(id) && entry.enabled && this._isRunning && !this._isPaused) {
        this._scheduleNext(id, entry);
      }
    }
  }

  _onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      console.log('[PollingCoordinator] Tab hidden - pausing all polling');
      this.pauseAll();
    } else {
      console.log('[PollingCoordinator] Tab visible - resuming polling');
      this.resumeAll();
    }
  }

  /**
   * Obtiene estadisticas del coordinator
   */
  getStats() {
    return {
      isRunning: this._isRunning,
      isPaused: this._isPaused,
      registeredCallbacks: this._callbacks.size,
      enabledCallbacks: Array.from(this._callbacks.values()).filter(e => e.enabled).length,
      callbacks: Array.from(this._callbacks.values()).map(e => ({
        name: e.name,
        intervalMs: e.intervalMs,
        priority: e.priority,
        enabled: e.enabled,
        isRunning: e.isRunning,
        hasTimer: !!e.timerId
      }))
    };
  }
}

// Singleton
const pollingCoordinator = new PollingCoordinator();

export default pollingCoordinator;
