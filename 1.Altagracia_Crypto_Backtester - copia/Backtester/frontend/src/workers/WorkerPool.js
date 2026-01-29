/**
 * WorkerPool - Gestiona Web Workers para cálculos pesados
 * Proporciona una API simple basada en Promises
 */

class WorkerPool {
  constructor() {
    this.workers = {};
    this.messageId = 0;
    this.pendingMessages = new Map();
  }

  /**
   * Obtiene o crea un worker
   * @param {string} name - Nombre del worker ('volumeProfile' o 'patternDetection')
   */
  getWorker(name) {
    if (!this.workers[name]) {
      let workerUrl;

      switch (name) {
        case 'volumeProfile':
          workerUrl = new URL('./VolumeProfileWorker.js', import.meta.url);
          break;
        case 'patternDetection':
          workerUrl = new URL('./PatternDetectionWorker.js', import.meta.url);
          break;
        default:
          throw new Error(`Unknown worker: ${name}`);
      }

      const worker = new Worker(workerUrl, { type: 'module' });

      worker.onmessage = (e) => {
        const { id, success, result, error } = e.data;
        const pending = this.pendingMessages.get(id);

        if (pending) {
          this.pendingMessages.delete(id);

          if (success) {
            pending.resolve(result);
          } else {
            pending.reject(new Error(error));
          }
        }
      };

      worker.onerror = (error) => {
        console.error(`[WorkerPool] Error in ${name} worker:`, error);
      };

      this.workers[name] = worker;
    }

    return this.workers[name];
  }

  /**
   * Envía un mensaje a un worker y espera la respuesta
   * @param {string} workerName - Nombre del worker
   * @param {string} type - Tipo de mensaje
   * @param {Object} data - Datos a enviar
   * @returns {Promise} - Promesa con el resultado
   */
  postMessage(workerName, type, data) {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      const worker = this.getWorker(workerName);

      this.pendingMessages.set(id, { resolve, reject });

      worker.postMessage({ id, type, data });

      // Timeout de 30 segundos
      setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id);
          reject(new Error(`Worker timeout for message ${id}`));
        }
      }, 30000);
    });
  }

  /**
   * Termina todos los workers
   */
  terminate() {
    for (const name in this.workers) {
      this.workers[name].terminate();
    }
    this.workers = {};
    this.pendingMessages.clear();
  }

  // ==================== MÉTODOS DE CONVENIENCIA ====================

  /**
   * Calcula Volume Profile
   * @param {Array} candles - Velas
   * @param {number} rowCount - Número de filas
   * @param {number} valueAreaPercent - % de Value Area
   */
  async calculateVolumeProfile(candles, rowCount = 100, valueAreaPercent = 70) {
    return this.postMessage('volumeProfile', 'CALCULATE_PROFILE', {
      candles,
      rowCount,
      valueAreaPercent
    });
  }

  /**
   * Detecta clusters de volumen
   * @param {Array} bins - Bins del Volume Profile
   * @param {number} threshold - Umbral mínimo
   */
  async detectVolumeClusters(bins, threshold = 30) {
    return this.postMessage('volumeProfile', 'DETECT_CLUSTERS', {
      bins,
      threshold
    });
  }

  /**
   * Detecta patrones de rechazo
   * @param {Array} candles - Velas
   * @param {Object} config - Configuración
   */
  async detectRejectionPatterns(candles, config = {}) {
    return this.postMessage('patternDetection', 'DETECT_REJECTION_PATTERNS', {
      candles,
      config
    });
  }

  /**
   * Detecta swing points
   * @param {Array} candles - Velas
   * @param {number} leftBars - Barras izquierda
   * @param {number} rightBars - Barras derecha
   */
  async detectSwingPoints(candles, leftBars = 5, rightBars = 5) {
    return this.postMessage('patternDetection', 'DETECT_SWING_POINTS', {
      candles,
      leftBars,
      rightBars
    });
  }

  /**
   * Calcula Z-scores
   * @param {Array} values - Array de valores
   * @param {number} period - Período
   */
  async calculateZScores(values, period = 20) {
    return this.postMessage('patternDetection', 'CALCULATE_ZSCORES', {
      values,
      period
    });
  }
}

// Singleton para uso global
const workerPool = new WorkerPool();

export default workerPool;
export { WorkerPool };
