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
  constructor(startTime, endTime, timeframe, onTimeUpdate, simulationStartTime = null) {
    this.startTime = startTime; // timestamp en ms - INICIO DEL HISTORIAL (para mostrar todo)
    this.endTime = endTime; // timestamp en ms
    this.simulationStartTime = simulationStartTime || startTime; // timestamp donde EMPIEZA la simulación
    this.currentTime = this.simulationStartTime; // Inicializar en simulationStartTime, no en startTime
    this.timeframe = timeframe; // "15m", "1h", "4h"
    this.playbackSpeed = 1; // 1x, 2x, 5x, etc.
    this.isPlaying = false;
    this.interval = null;
    this.onTimeUpdate = onTimeUpdate; // Callback cuando cambia el tiempo

    // Configuración de timeframes (en minutos)
    this.timeframeMinutes = {
      "1m": 1,      // 1 minuto - NUEVO
      "5m": 5,      // 5 minutos - NUEVO
      "15m": 15,
      "1h": 60,
      "4h": 240
    };

    // Configuración de subdivisiones intravela (estados internos)
    // Para timeframes pequeños, avanzamos vela completa para evitar lentitud extrema
    this.subdivisionConfig = {
      "1m": { interval: 1, count: 1 },    // 1 estado de 1min (vela completa) - NUEVO
      "5m": { interval: 1, count: 5 },    // 5 estados de 1min cada uno - NUEVO
      "15m": { interval: 5, count: 3 },   // 3 estados de 5min cada uno
      "1h": { interval: 15, count: 4 },   // 4 estados de 15min cada uno
      "4h": { interval: 60, count: 4 }    // 4 estados de 1h cada uno
    };

    // Estado actual de la subdivisión
    this.currentSubdivision = 0; // 0, 1, 2, ... hasta count-1

    // BroadcastChannel para sincronización multi-pestaña
    this.syncChannel = null;
    this.isMaster = false; // Solo una pestaña es master

    console.log(`[TimeController] Inicializado:`);
    console.log(`  - Historial: ${new Date(startTime).toISOString()} → ${new Date(endTime).toISOString()}`);
    console.log(`  - Simulación inicia: ${new Date(this.simulationStartTime).toISOString()}`);
    console.log(`  - CurrentTime: ${new Date(this.currentTime).toISOString()}`);
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

    // Si estamos al final, resetear automáticamente al inicio de la simulación para poder reproducir
    if (this.currentTime >= this.endTime) {
      console.log('[TimeController] Estamos al final, reseteando al inicio de la simulación para reproducir...');
      this.currentTime = this.simulationStartTime;
      if (this.onTimeUpdate) {
        this.onTimeUpdate(this.currentTime);
      }
    }

    this.isPlaying = true;

    // Calcular intervalo de actualización basado en velocidad y subdivisiones
    // El intervalo base es el tiempo real del timeframe en ms
    // Ejemplo: 15min @ 1x = 15 * 60 * 1000 = 900,000ms
    // Pero dividimos por el número de subdivisiones para mostrar estados intravela
    const subdivisions = this.subdivisionConfig[this.timeframe];
    const timeframeMs = this.timeframeMinutes[this.timeframe] * 60 * 1000;
    const subdivisionMs = (subdivisions.interval * 60 * 1000);

    // Calcular el intervalo de actualización según la velocidad
    // En 1x, cada subdivisión debe tardar su tiempo real
    // Ejemplo: 15min @ 1x con 3 subdivisiones = 5min por subdivisión = 300,000ms
    // En 15x: 300,000ms / 15 = 20,000ms = 20 segundos por subdivisión
    const updateIntervalMs = Math.max(16, subdivisionMs / this.playbackSpeed); // mínimo 16ms (60fps)

    console.log(`[TimeController] ▶️ Play @ ${this.playbackSpeed}x - interval: ${updateIntervalMs}ms - subdivisiones: ${subdivisions.count} - currentTime: ${new Date(this.currentTime).toISOString()}`);

    this.interval = setInterval(() => {
      const increment = this.getTimeIncrement();
      this.currentTime += increment;

      // Avanzar subdivisión
      this.currentSubdivision++;
      if (this.currentSubdivision >= subdivisions.count) {
        this.currentSubdivision = 0;
      }

      console.log(`[TimeController] Tick - currentTime: ${new Date(this.currentTime).toISOString()}, increment: ${increment}ms, subdivision: ${this.currentSubdivision}/${subdivisions.count}`);

      // Si llegamos al final, pausar
      if (this.currentTime >= this.endTime) {
        this.currentTime = this.endTime;
        console.log('[TimeController] Llegamos al final');
        this.pause();
      }

      // Notificar cambio
      console.log(`[TimeController] 🔍 DEBUG: onTimeUpdate exists? ${!!this.onTimeUpdate}, type: ${typeof this.onTimeUpdate}`);
      if (this.onTimeUpdate) {
        console.log(`[TimeController] ✅ Calling onTimeUpdate with timestamp: ${this.currentTime}`);
        this.onTimeUpdate(this.currentTime);
        console.log(`[TimeController] ✅ onTimeUpdate completed`);
      } else {
        console.warn('[TimeController] ⚠️ No hay callback onTimeUpdate');
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
   * Detiene la reproducción (igual que pause, NO resetea al inicio)
   * Para resetear manualmente, usar jumpTo(startTime) o reset()
   */
  stop() {
    this.pause();
    // NO resetear currentTime - mantener posición actual
    // Si el usuario quiere volver al inicio, puede usar el método reset()
    console.log('[TimeController] ⏹️ Stop (mantiene posición actual)');
  }

  /**
   * Resetea al inicio de la simulación (NO al inicio del historial)
   */
  reset() {
    this.pause();
    this.currentTime = this.simulationStartTime;

    if (this.onTimeUpdate) {
      this.onTimeUpdate(this.currentTime);
    }

    this.broadcastState();
    console.log('[TimeController] 🔄 Reset al inicio de la simulación');
  }

  /**
   * Salta a una fecha específica (solo dentro del rango de simulación)
   */
  jumpTo(timestamp) {
    const wasPlaying = this.isPlaying;

    if (wasPlaying) {
      this.pause();
    }

    // Permitir saltar solo entre simulationStartTime y endTime
    this.currentTime = Math.max(this.simulationStartTime, Math.min(timestamp, this.endTime));

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
   * Calcula el incremento de tiempo por tick según subdivisión
   * Avanza por subdivisiones (estados intravela) en lugar de velas completas
   * Ejemplo: 15m con 3 subdivisiones → avanza 5 min por tick
   */
  getTimeIncrement() {
    // Avanzar por subdivisión (estado intravela)
    const subdivisions = this.subdivisionConfig[this.timeframe];
    const subdivisionIncrement = subdivisions.interval * 60 * 1000; // ms
    return subdivisionIncrement;
  }

  /**
   * Obtiene el progreso actual (0-100%) basado en el rango de simulación
   */
  getProgress() {
    const totalDuration = this.endTime - this.simulationStartTime;
    const elapsed = this.currentTime - this.simulationStartTime;
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
      simulationStartTime: this.simulationStartTime,
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
    this.simulationStartTime = state.simulationStartTime || state.startTime; // Retrocompatibilidad
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
