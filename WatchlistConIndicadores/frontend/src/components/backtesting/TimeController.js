/**
 * TimeController - Control de reproducción temporal para backtesting
 *
 * Maneja la simulación de tiempo en el backtesting, permitiendo:
 * - Play/Pause/Stop
 * - Control de velocidad (1x, 2x, 5x, 10x, etc.)
 * - Saltar a fecha específica
 * - Sincronización entre múltiples gráficos (via BroadcastChannel)
 */

class TimeController {
  constructor(startTime, endTime, timeframe, onTimeUpdate) {
    this.startTime = startTime; // timestamp en ms
    this.endTime = endTime; // timestamp en ms
    this.currentTime = startTime;
    this.timeframe = timeframe; // "15m", "1h", "4h"
    this.playbackSpeed = 1; // 1x, 2x, 5x, etc.
    this.isPlaying = false;
    this.interval = null;
    this.onTimeUpdate = onTimeUpdate; // Callback cuando cambia el tiempo

    // Configuración de timeframes (en minutos)
    this.timeframeMinutes = {
      "15m": 15,
      "1h": 60,
      "4h": 240
    };

    // BroadcastChannel para sincronización multi-pestaña
    this.syncChannel = null;
    this.isMaster = false; // Solo una pestaña es master

    console.log(`[TimeController] Inicializado: ${new Date(startTime).toISOString()} → ${new Date(endTime).toISOString()}`);
  }

  /**
   * Inicializa sincronización multi-pestaña
   */
  initSync(sessionId) {
    if (typeof BroadcastChannel === 'undefined') {
      console.warn('[TimeController] BroadcastChannel no soportado');
      return;
    }

    this.syncChannel = new BroadcastChannel(`backtesting_sync_${sessionId}`);

    // Escuchar mensajes de otras pestañas
    this.syncChannel.onmessage = (event) => {
      const { type, data } = event.data;

      switch (type) {
        case 'TIME_UPDATE':
          if (!this.isMaster) {
            this.currentTime = data.currentTime;
            this.isPlaying = data.isPlaying;
            this.playbackSpeed = data.playbackSpeed;
            if (this.onTimeUpdate) {
              this.onTimeUpdate(this.currentTime);
            }
          }
          break;

        case 'MASTER_CLAIM':
          // Otra pestaña se declaró master
          if (this.isMaster && data.timestamp > this.masterClaimTimestamp) {
            console.log('[TimeController] Cediendo rol de master');
            this.isMaster = false;
          }
          break;

        case 'MASTER_REQUEST':
          // Alguien pregunta si hay master
          if (this.isMaster) {
            this.syncChannel.postMessage({
              type: 'MASTER_CLAIM',
              data: { timestamp: this.masterClaimTimestamp }
            });
          }
          break;
      }
    };

    // Intentar reclamar rol de master
    this.claimMaster();
  }

  /**
   * Reclama el rol de master (controla el tiempo)
   */
  claimMaster() {
    this.masterClaimTimestamp = Date.now();
    this.isMaster = true;

    if (this.syncChannel) {
      // Preguntar si ya hay un master
      this.syncChannel.postMessage({ type: 'MASTER_REQUEST' });

      // Si nadie responde en 500ms, somos master
      setTimeout(() => {
        if (this.isMaster) {
          console.log('[TimeController] Rol de master reclamado');
          this.syncChannel.postMessage({
            type: 'MASTER_CLAIM',
            data: { timestamp: this.masterClaimTimestamp }
          });
        }
      }, 500);
    }
  }

  /**
   * Broadcast del estado actual a otras pestañas
   */
  broadcastState() {
    if (this.syncChannel && this.isMaster) {
      this.syncChannel.postMessage({
        type: 'TIME_UPDATE',
        data: {
          currentTime: this.currentTime,
          isPlaying: this.isPlaying,
          playbackSpeed: this.playbackSpeed
        }
      });
    }
  }

  /**
   * Inicia la reproducción
   */
  play() {
    if (this.isPlaying) {
      console.log('[TimeController] Ya está reproduciendo');
      return;
    }

    this.isPlaying = true;
    const updateIntervalMs = 1000; // Actualizar cada segundo

    console.log(`[TimeController] ▶️ Play @ ${this.playbackSpeed}x - currentTime: ${new Date(this.currentTime).toISOString()}`);

    this.interval = setInterval(() => {
      const increment = this.getTimeIncrement();
      this.currentTime += increment;

      console.log(`[TimeController] Tick - currentTime: ${new Date(this.currentTime).toISOString()}, increment: ${increment}ms`);

      // Si llegamos al final, pausar
      if (this.currentTime >= this.endTime) {
        this.currentTime = this.endTime;
        console.log('[TimeController] Llegamos al final');
        this.pause();
      }

      // Notificar cambio
      if (this.onTimeUpdate) {
        this.onTimeUpdate(this.currentTime);
      } else {
        console.warn('[TimeController] No hay callback onTimeUpdate');
      }

      // Sincronizar con otras pestañas
      this.broadcastState();

    }, updateIntervalMs);
  }

  /**
   * Pausa la reproducción
   */
  pause() {
    if (!this.isPlaying) return;

    this.isPlaying = false;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.broadcastState();
    console.log('[TimeController] ⏸️ Pause');
  }

  /**
   * Detiene y resetea al inicio
   */
  stop() {
    this.pause();
    this.currentTime = this.startTime;

    if (this.onTimeUpdate) {
      this.onTimeUpdate(this.currentTime);
    }

    this.broadcastState();
    console.log('[TimeController] ⏹️ Stop');
  }

  /**
   * Salta a una fecha específica
   */
  jumpTo(timestamp) {
    const wasPlaying = this.isPlaying;

    if (wasPlaying) {
      this.pause();
    }

    this.currentTime = Math.max(this.startTime, Math.min(timestamp, this.endTime));

    if (this.onTimeUpdate) {
      this.onTimeUpdate(this.currentTime);
    }

    if (wasPlaying) {
      this.play();
    }

    this.broadcastState();
    console.log(`[TimeController] ⏭️ Jump to ${new Date(this.currentTime).toISOString()}`);
  }

  /**
   * Cambia la velocidad de reproducción
   */
  setSpeed(speed) {
    const wasPlaying = this.isPlaying;

    if (wasPlaying) {
      this.pause();
    }

    this.playbackSpeed = speed;

    if (wasPlaying) {
      this.play();
    }

    this.broadcastState();
    console.log(`[TimeController] ⚡ Speed: ${speed}x`);
  }

  /**
   * Calcula el incremento de tiempo por tick según velocidad y timeframe
   */
  getTimeIncrement() {
    // Con 1x de velocidad:
    // - Cada segundo real avanza 1 intervalo del timeframe
    // - 15m: cada segundo avanza 15 minutos
    // - 1h: cada segundo avanza 1 hora
    // - 4h: cada segundo avanza 4 horas

    const baseIncrement = this.timeframeMinutes[this.timeframe] * 60 * 1000; // ms
    return baseIncrement * this.playbackSpeed;
  }

  /**
   * Obtiene el progreso actual (0-100%)
   */
  getProgress() {
    const totalDuration = this.endTime - this.startTime;
    const elapsed = this.currentTime - this.startTime;
    return (elapsed / totalDuration) * 100;
  }

  /**
   * Obtiene el tiempo restante en ms
   */
  getTimeRemaining() {
    return this.endTime - this.currentTime;
  }

  /**
   * Limpia recursos
   */
  destroy() {
    this.pause();

    if (this.syncChannel) {
      this.syncChannel.close();
      this.syncChannel = null;
    }

    console.log('[TimeController] 🧹 Destroyed');
  }

  /**
   * Obtiene estado actual para serialización
   */
  getState() {
    return {
      startTime: this.startTime,
      endTime: this.endTime,
      currentTime: this.currentTime,
      timeframe: this.timeframe,
      playbackSpeed: this.playbackSpeed,
      isPlaying: this.isPlaying,
      progress: this.getProgress()
    };
  }

  /**
   * Restaura estado desde serialización
   */
  setState(state) {
    const wasPlaying = this.isPlaying;

    if (wasPlaying) {
      this.pause();
    }

    this.startTime = state.startTime;
    this.endTime = state.endTime;
    this.currentTime = state.currentTime;
    this.timeframe = state.timeframe;
    this.playbackSpeed = state.playbackSpeed;

    if (this.onTimeUpdate) {
      this.onTimeUpdate(this.currentTime);
    }

    if (state.isPlaying && !wasPlaying) {
      this.play();
    }

    console.log('[TimeController] 🔄 State restored');
  }
}

export default TimeController;
