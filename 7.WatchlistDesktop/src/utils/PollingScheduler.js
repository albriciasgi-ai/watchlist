// src/utils/PollingScheduler.js
// ✅ OPTIMIZACIÓN: Scheduler centralizado para coordinar polling de indicadores
// Evita múltiples timers corriendo en paralelo, reduce context switching

/**
 * PollingScheduler - Coordina el polling de múltiples indicadores
 *
 * Beneficios:
 * - Un solo timer en lugar de N timers (uno por indicador)
 * - Respeta visibilidad del tab (pausa cuando oculto)
 * - Batching de requests similares
 * - Fácil de pausar/resumir globalmente
 */
class PollingScheduler {
  constructor() {
    // Callbacks registrados: Map<id, {callback, intervalMs, lastRun, priority}>
    this._callbacks = new Map();

    // Timer principal
    this._mainTimer = null;
    this._tickIntervalMs = 1000; // Tick cada 1 segundo

    // Estado
    this._isRunning = false;
    this._isPaused = false;

    // Listener de visibilidad
    this._visibilityHandler = this._onVisibilityChange.bind(this);

    // Contador para IDs únicos
    this._idCounter = 0;
  }

  /**
   * Inicia el scheduler
   */
  start() {
    if (this._isRunning) return;

    this._isRunning = true;
    this._isPaused = document.visibilityState === 'hidden';

    // Escuchar cambios de visibilidad
    document.addEventListener('visibilitychange', this._visibilityHandler);

    // Iniciar timer principal
    this._startMainTimer();

    console.log('[PollingScheduler] Started');
  }

  /**
   * Detiene el scheduler
   */
  stop() {
    if (!this._isRunning) return;

    this._isRunning = false;

    // Remover listener
    document.removeEventListener('visibilitychange', this._visibilityHandler);

    // Detener timer
    if (this._mainTimer) {
      clearInterval(this._mainTimer);
      this._mainTimer = null;
    }

    console.log('[PollingScheduler] Stopped');
  }

  /**
   * Registra un callback para polling
   * @param {Function} callback - Función a ejecutar
   * @param {number} intervalMs - Intervalo en milisegundos
   * @param {number} priority - Prioridad (menor = más importante)
   * @returns {string} ID del registro para poder cancelar
   */
  register(callback, intervalMs, priority = 5) {
    const id = `poll_${++this._idCounter}`;

    this._callbacks.set(id, {
      callback,
      intervalMs,
      lastRun: 0,
      priority,
      enabled: true
    });

    console.log(`[PollingScheduler] Registered ${id} (interval: ${intervalMs}ms)`);
    return id;
  }

  /**
   * Cancela un callback registrado
   * @param {string} id - ID retornado por register()
   */
  unregister(id) {
    if (this._callbacks.has(id)) {
      this._callbacks.delete(id);
      console.log(`[PollingScheduler] Unregistered ${id}`);
    }
  }

  /**
   * Pausa un callback específico
   */
  pause(id) {
    const entry = this._callbacks.get(id);
    if (entry) {
      entry.enabled = false;
    }
  }

  /**
   * Reanuda un callback específico
   */
  resume(id) {
    const entry = this._callbacks.get(id);
    if (entry) {
      entry.enabled = true;
    }
  }

  /**
   * Pausa todo el scheduler
   */
  pauseAll() {
    this._isPaused = true;
  }

  /**
   * Reanuda todo el scheduler
   */
  resumeAll() {
    this._isPaused = false;
  }

  _startMainTimer() {
    if (this._mainTimer) {
      clearInterval(this._mainTimer);
    }

    this._mainTimer = setInterval(() => {
      this._tick();
    }, this._tickIntervalMs);
  }

  _tick() {
    // No hacer nada si está pausado o el tab no es visible
    if (this._isPaused || document.visibilityState === 'hidden') {
      return;
    }

    const now = Date.now();

    // Ordenar por prioridad
    const entries = Array.from(this._callbacks.entries())
      .filter(([_, entry]) => entry.enabled)
      .sort((a, b) => a[1].priority - b[1].priority);

    for (const [id, entry] of entries) {
      const elapsed = now - entry.lastRun;

      if (elapsed >= entry.intervalMs) {
        try {
          // Ejecutar callback
          const result = entry.callback();

          // Si retorna una promesa, no bloqueamos
          if (result instanceof Promise) {
            result.catch(err => {
              console.error(`[PollingScheduler] Error in ${id}:`, err);
            });
          }

          entry.lastRun = now;
        } catch (err) {
          console.error(`[PollingScheduler] Error in ${id}:`, err);
        }
      }
    }
  }

  _onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      console.log('[PollingScheduler] Tab hidden - pausing');
      this._isPaused = true;
    } else {
      console.log('[PollingScheduler] Tab visible - resuming');
      this._isPaused = false;

      // Ejecutar callbacks inmediatamente si han pasado sus intervalos
      this._tick();
    }
  }

  /**
   * Obtiene estadísticas del scheduler
   */
  getStats() {
    return {
      isRunning: this._isRunning,
      isPaused: this._isPaused,
      registeredCallbacks: this._callbacks.size,
      enabledCallbacks: Array.from(this._callbacks.values()).filter(e => e.enabled).length
    };
  }
}

// Singleton
const pollingScheduler = new PollingScheduler();

export default pollingScheduler;
