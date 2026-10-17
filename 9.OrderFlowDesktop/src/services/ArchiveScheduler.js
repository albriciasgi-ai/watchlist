// ArchiveScheduler.js - Programador automático de archivado de footprints
//
// Ejecuta archivado automático semanal de footprints desde Northflank.
// Configurable con días de la semana y hora.

import { getFootprintArchiver } from './FootprintArchiverElectron';

class ArchiveScheduler {
  constructor() {
    this.enabled = false;
    this.intervalId = null;
    this.lastRun = null;
    this.nextRun = null;

    // Configuración por defecto: Domingos a las 3:00 AM
    this.config = {
      dayOfWeek: 0, // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
      hour: 3,
      minute: 0,
      hoursToArchive: 168 // 1 semana
    };

    this._loadConfig();
  }

  /**
   * Carga configuración desde localStorage.
   */
  _loadConfig() {
    try {
      const saved = localStorage.getItem('archiveSchedulerConfig');
      if (saved) {
        this.config = { ...this.config, ...JSON.parse(saved) };
      }

      const lastRun = localStorage.getItem('archiveSchedulerLastRun');
      if (lastRun) {
        this.lastRun = parseInt(lastRun);
      }

      const enabled = localStorage.getItem('archiveSchedulerEnabled');
      if (enabled === 'true') {
        this.start();
      }
    } catch (error) {
      console.error('[ArchiveScheduler] Error cargando config:', error);
    }
  }

  /**
   * Guarda configuración en localStorage.
   */
  _saveConfig() {
    try {
      localStorage.setItem('archiveSchedulerConfig', JSON.stringify(this.config));
      localStorage.setItem('archiveSchedulerEnabled', this.enabled.toString());
      if (this.lastRun) {
        localStorage.setItem('archiveSchedulerLastRun', this.lastRun.toString());
      }
    } catch (error) {
      console.error('[ArchiveScheduler] Error guardando config:', error);
    }
  }

  /**
   * Calcula el próximo timestamp de ejecución.
   *
   * @returns {number} - Timestamp del próximo archivado
   */
  _calculateNextRun() {
    const now = new Date();
    const target = new Date();

    // Configurar día de la semana objetivo
    const currentDay = now.getDay();
    let daysUntilTarget = this.config.dayOfWeek - currentDay;

    if (daysUntilTarget < 0) {
      daysUntilTarget += 7; // Próxima semana
    } else if (daysUntilTarget === 0) {
      // Mismo día - verificar si ya pasó la hora
      if (now.getHours() > this.config.hour ||
          (now.getHours() === this.config.hour && now.getMinutes() >= this.config.minute)) {
        daysUntilTarget = 7; // Próxima semana
      }
    }

    target.setDate(now.getDate() + daysUntilTarget);
    target.setHours(this.config.hour, this.config.minute, 0, 0);

    return target.getTime();
  }

  /**
   * Verifica si es momento de ejecutar el archivado.
   *
   * @returns {boolean} - True si debe ejecutarse
   */
  _shouldRun() {
    const now = Date.now();

    // Verificar si ya corrió hoy
    if (this.lastRun) {
      const lastRunDate = new Date(this.lastRun);
      const nowDate = new Date(now);

      if (lastRunDate.toDateString() === nowDate.toDateString()) {
        console.log('[ArchiveScheduler] Ya se ejecutó hoy, saltando...');
        return false;
      }
    }

    // Verificar día de la semana
    const nowDate = new Date(now);
    if (nowDate.getDay() !== this.config.dayOfWeek) {
      return false;
    }

    // Verificar hora (con margen de ±5 minutos)
    const currentHour = nowDate.getHours();
    const currentMinute = nowDate.getMinutes();

    const targetMinutes = this.config.hour * 60 + this.config.minute;
    const currentMinutes = currentHour * 60 + currentMinute;
    const diff = Math.abs(currentMinutes - targetMinutes);

    return diff <= 5; // Margen de 5 minutos
  }

  /**
   * Ejecuta el archivado automático.
   */
  async _runArchive() {
    console.log('[ArchiveScheduler] 🚀 Ejecutando archivado automático...');

    const archiver = getFootprintArchiver();

    try {
      const result = await archiver.archiveAll(
        this.config.hoursToArchive,
        (progress) => {
          console.log(`[ArchiveScheduler] Progreso: ${progress.symbol} (${progress.current}/${progress.total})`);
        }
      );

      this.lastRun = Date.now();
      this._saveConfig();

      console.log('[ArchiveScheduler] ✅ Archivado completado:');
      console.log(`  Exitosos: ${result.successful}`);
      console.log(`  Fallidos: ${result.failed}`);
      console.log(`  Total descargados: ${result.totalDownloaded}`);
      console.log(`  Total nuevos: ${result.totalAdded}`);

      // Notificación al usuario (si la app está abierta)
      if (window.Notification && Notification.permission === 'granted') {
        new Notification('Archivado de Footprints Completado', {
          body: `${result.totalAdded} nuevos footprints archivados (${result.successful}/${result.successful + result.failed} símbolos)`,
          icon: '/icon.png'
        });
      }

      return result;

    } catch (error) {
      console.error('[ArchiveScheduler] Error en archivado automático:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Tick del scheduler (se ejecuta cada minuto).
   */
  async _tick() {
    if (!this.enabled) return;

    // Actualizar próxima ejecución
    this.nextRun = this._calculateNextRun();

    // Verificar si debe ejecutarse
    if (this._shouldRun()) {
      await this._runArchive();
    }
  }

  /**
   * Inicia el scheduler.
   */
  start() {
    if (this.enabled) {
      console.log('[ArchiveScheduler] Ya está iniciado');
      return;
    }

    this.enabled = true;
    this.nextRun = this._calculateNextRun();

    // Ejecutar tick cada minuto
    this.intervalId = setInterval(() => {
      this._tick();
    }, 60 * 1000); // 1 minuto

    this._saveConfig();

    const nextRunDate = new Date(this.nextRun);
    console.log('[ArchiveScheduler] ✅ Scheduler iniciado');
    console.log(`[ArchiveScheduler] Próxima ejecución: ${nextRunDate.toLocaleString()}`);
  }

  /**
   * Detiene el scheduler.
   */
  stop() {
    if (!this.enabled) {
      console.log('[ArchiveScheduler] Ya está detenido');
      return;
    }

    this.enabled = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this._saveConfig();

    console.log('[ArchiveScheduler] ⏹️ Scheduler detenido');
  }

  /**
   * Configura el scheduler.
   *
   * @param {Object} newConfig - Nueva configuración
   */
  configure(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this._saveConfig();

    // Recalcular próxima ejecución
    if (this.enabled) {
      this.nextRun = this._calculateNextRun();

      const nextRunDate = new Date(this.nextRun);
      console.log('[ArchiveScheduler] Configuración actualizada');
      console.log(`[ArchiveScheduler] Próxima ejecución: ${nextRunDate.toLocaleString()}`);
    }
  }

  /**
   * Ejecuta archivado manual inmediato.
   *
   * @param {number} hours - Horas a archivar (opcional)
   * @returns {Promise<Object>} - Resultado
   */
  async runNow(hours = null) {
    console.log('[ArchiveScheduler] 🚀 Ejecutando archivado manual...');

    const hoursToArchive = hours || this.config.hoursToArchive;

    const archiver = getFootprintArchiver();
    const result = await archiver.archiveAll(hoursToArchive);

    this.lastRun = Date.now();
    this._saveConfig();

    return result;
  }

  /**
   * Obtiene estado actual del scheduler.
   *
   * @returns {Object} - Estado
   */
  getStatus() {
    return {
      enabled: this.enabled,
      config: this.config,
      lastRun: this.lastRun,
      lastRunDate: this.lastRun ? new Date(this.lastRun).toLocaleString() : null,
      nextRun: this.nextRun,
      nextRunDate: this.nextRun ? new Date(this.nextRun).toLocaleString() : null,
      daysUntilNextRun: this.nextRun ? Math.ceil((this.nextRun - Date.now()) / (1000 * 60 * 60 * 24)) : null
    };
  }
}

// Singleton instance
let schedulerInstance = null;

export const getArchiveScheduler = () => {
  if (!schedulerInstance) {
    schedulerInstance = new ArchiveScheduler();
  }
  return schedulerInstance;
};

export default ArchiveScheduler;
