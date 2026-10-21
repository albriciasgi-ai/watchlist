// FootprintArchiverElectron.js - Versión con almacenamiento en sistema de archivos
//
// Almacena footprints en archivos JSON en userData de Electron (persistencia garantizada).
// NO usa IndexedDB - solo almacenamiento en File System.

const CLOUD_COLLECTOR_URL = "https://p01--altagracia--rxv8nrbhxln9.code.run";

class FootprintArchiverElectron {
  constructor() {
    this.downloading = false;
    this.progress = 0;
    this.currentSymbol = null;

    // Directorio de almacenamiento (userData de Electron)
    this.storageDir = null;

    // Configuración
    this.config = {
      symbols: [
        'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT',
        'TRXUSDT', 'DOGEUSDT', 'BNBUSDT', 'AVAXUSDT', 'ARBUSDT'
      ],
      interval: '1',  // SOLO 1 minuto (los intervalos mayores se agregan en frontend)
      maxHoursPerRequest: 720,  // 30 días de historia (1 mes completo - disponible en Northflank)
      timeout: 180000  // 3 minutos (aumentado de 2 min)
    };

    this._initStorage();
  }

  /**
   * Inicializa el almacenamiento.
   */
  async _initStorage() {
    try {
      // Obtener ruta de userData desde Electron
      if (window.electron && window.electron.getUserDataPath) {
        const userDataPath = await window.electron.getUserDataPath();
        // Usar concatenación en lugar de path.join (compatible con browser)
        this.storageDir = userDataPath + '/footprint_archive';

        // Crear directorio si no existe
        await window.electron.ensureDir(this.storageDir);

        console.log(`[FootprintArchiver] Storage dir: ${this.storageDir}`);
      } else {
        console.error('[FootprintArchiver] Electron API no disponible - NO SE PUEDE USAR FILE SYSTEM');
        this.storageDir = null;
      }

    } catch (error) {
      console.error('[FootprintArchiver] Error inicializando storage:', error);
    }
  }

  /**
   * Obtiene la ruta del archivo para un símbolo.
   *
   * @param {string} symbol - Símbolo
   * @returns {string} - Ruta completa del archivo
   */
  _getFilePath(symbol) {
    if (!this.storageDir) {
      throw new Error('Storage directory no configurado');
    }

    return `${this.storageDir}/${symbol}_${this.config.interval}.json`;
  }

  /**
   * Lee footprints desde archivo.
   *
   * @param {string} symbol - Símbolo
   * @returns {Promise<Array>} - Footprints
   */
  async _readFromFile(symbol) {
    if (!window.electron || !this.storageDir) {
      return [];
    }

    try {
      const filePath = this._getFilePath(symbol);
      const exists = await window.electron.fileExists(filePath);

      if (!exists) {
        return [];
      }

      const content = await window.electron.readFile(filePath);
      const data = JSON.parse(content);

      return data.footprints || [];

    } catch (error) {
      console.error(`[FootprintArchiver] Error leyendo ${symbol}:`, error);
      return [];
    }
  }

  /**
   * Guarda footprints en archivo.
   *
   * @param {string} symbol - Símbolo
   * @param {Array} footprints - Footprints a guardar
   */
  async _writeToFile(symbol, footprints) {
    if (!window.electron || !this.storageDir) {
      throw new Error('Electron API no disponible');
    }

    try {
      const filePath = this._getFilePath(symbol);

      // Ordenar por timestamp
      const sorted = footprints.sort((a, b) => a.candle_timestamp - b.candle_timestamp);

      // Calcular metadata
      const timestamps = sorted.map(fp => fp.candle_timestamp);
      const metadata = {
        symbol,
        interval: this.config.interval,
        count: sorted.length,
        oldestTimestamp: timestamps[0],
        newestTimestamp: timestamps[timestamps.length - 1],
        lastUpdated: Date.now()
      };

      const data = {
        ...metadata,
        footprints: sorted
      };

      // Guardar archivo
      await window.electron.writeFile(filePath, JSON.stringify(data, null, 2));

      console.log(`[FootprintArchiver] ${symbol}: guardados ${sorted.length} footprints en ${filePath}`);

      return metadata;

    } catch (error) {
      console.error(`[FootprintArchiver] Error guardando ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Descarga footprints del cloud collector.
   * Usa IPC con Main Process para bypass de CORS.
   */
  async _fetchFromCloud(symbol, hours) {
    const daysRequested = (hours / 24).toFixed(1);
    console.log(`[FootprintArchiver] 🌐 Descargando ${symbol}: ${hours}h (~${daysRequested} días)`);
    console.log(`[FootprintArchiver] 🔍 URL cloud: ${CLOUD_COLLECTOR_URL}/api/footprints/${symbol}?hours=${hours}&interval=${this.config.interval}`);

    const startTime = Date.now();

    try {
      // Verificar que window.electron.downloadFootprints existe
      if (!window.electron || !window.electron.downloadFootprints) {
        throw new Error('window.electron.downloadFootprints no disponible - ejecutar en Electron');
      }

      console.log(`[FootprintArchiver] ⏳ Esperando respuesta del cloud...`);

      // Descargar via Main Process (sin restricciones CORS)
      const footprints = await window.electron.downloadFootprints(
        symbol,
        hours,
        this.config.interval
      );

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(`[FootprintArchiver] ✅ ${symbol}: ${footprints.length} footprints descargados en ${elapsed}s`);

      if (footprints.length > 0) {
        // Calcular rango temporal de los datos descargados
        const timestamps = footprints.map(fp => fp.candle_timestamp).sort((a, b) => a - b);
        const oldestTs = timestamps[0];
        const newestTs = timestamps[timestamps.length - 1];
        const oldestDate = new Date(oldestTs).toLocaleString('es-ES');
        const newestDate = new Date(newestTs).toLocaleString('es-ES');
        const rangeDays = ((newestTs - oldestTs) / (1000 * 60 * 60 * 24)).toFixed(1);

        console.log(`[FootprintArchiver] 🔍 ${symbol} RANGO DESCARGADO:`);
        console.log(`[FootprintArchiver]   • Desde: ${oldestDate}`);
        console.log(`[FootprintArchiver]   • Hasta: ${newestDate}`);
        console.log(`[FootprintArchiver]   • Cobertura: ${rangeDays} días (~${timestamps.length} footprints de ${this.config.interval}min)`);
      } else {
        console.warn(`[FootprintArchiver] ⚠️ ${symbol}: Cloud retornó 0 footprints después de ${elapsed}s`);
      }

      return footprints;

    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`[FootprintArchiver] ❌ ${symbol}: Error descargando después de ${elapsed}s:`, error.message);
      return [];
    }
  }

  /**
   * Hace merge de footprints nuevos con existentes.
   *
   * @param {Array} existing - Footprints existentes
   * @param {Array} newFootprints - Footprints nuevos
   * @returns {Object} - { merged, added, updated, skipped }
   */
  _mergeFootprints(existing, newFootprints) {
    const timestampMap = new Map();

    // Indexar existentes
    existing.forEach(fp => {
      timestampMap.set(fp.candle_timestamp, fp);
    });

    let added = 0;
    let updated = 0;
    let skipped = 0;

    // Merge nuevos
    newFootprints.forEach(fp => {
      const existingFp = timestampMap.get(fp.candle_timestamp);

      if (!existingFp) {
        // Nuevo
        timestampMap.set(fp.candle_timestamp, fp);
        added++;
      } else {
        // Comparar si es diferente
        if (JSON.stringify(existingFp) !== JSON.stringify(fp)) {
          timestampMap.set(fp.candle_timestamp, fp);
          updated++;
        } else {
          skipped++;
        }
      }
    });

    const merged = Array.from(timestampMap.values());

    return { merged, added, updated, skipped };
  }

  /**
   * Archiva footprints de un símbolo.
   *
   * @param {string} symbol - Símbolo
   * @param {number} hours - Horas a descargar
   * @returns {Promise<Object>} - Resultado
   */
  async archiveSymbol(symbol, hours = 168) {
    const daysRequested = (hours / 24).toFixed(1);
    console.log(`[FootprintArchiver] 📥 Archivando ${symbol} (${hours}h = ~${daysRequested} días)...`);

    this.currentSymbol = symbol;

    try {
      // 1. Descargar desde cloud
      const downloaded = await this._fetchFromCloud(symbol, hours);

      if (downloaded.length === 0) {
        console.error(`[FootprintArchiver] ❌ ${symbol}: No hay datos en el cloud (0 footprints descargados)`);
        return {
          success: false,
          symbol,
          error: 'No hay datos disponibles en el cloud collector'
        };
      }

      console.log(`[FootprintArchiver] 📦 ${symbol}: Descargados ${downloaded.length} footprints del cloud`);

      // 2. Leer footprints existentes
      const existing = await this._readFromFile(symbol);

      if (existing.length > 0) {
        const existOldest = new Date(Math.min(...existing.map(fp => fp.candle_timestamp))).toLocaleString('es-ES');
        const existNewest = new Date(Math.max(...existing.map(fp => fp.candle_timestamp))).toLocaleString('es-ES');
        console.log(`[FootprintArchiver] 💾 ${symbol}: ${existing.length} footprints en archivo local (${existOldest} → ${existNewest})`);
      } else {
        console.log(`[FootprintArchiver] 💾 ${symbol}: Archivo local vacío (primera descarga)`);
      }

      // 3. Merge
      const { merged, added, updated, skipped } = this._mergeFootprints(existing, downloaded);
      console.log(`[FootprintArchiver] 🔄 ${symbol}: Merge - +${added} nuevos, ~${updated} actualizados, =${skipped} duplicados`);

      // 4. Guardar archivo actualizado
      const metadata = await this._writeToFile(symbol, merged);

      // Calcular y mostrar rango final
      const finalOldest = new Date(metadata.oldestTimestamp).toLocaleString('es-ES');
      const finalNewest = new Date(metadata.newestTimestamp).toLocaleString('es-ES');
      const finalDays = ((metadata.newestTimestamp - metadata.oldestTimestamp) / (1000 * 60 * 60 * 24)).toFixed(1);

      console.log(`[FootprintArchiver] ✅ ${symbol}: GUARDADO - ${merged.length} footprints totales`);
      console.log(`[FootprintArchiver] 📊 ${symbol}: RANGO FINAL - ${finalDays} días (${finalOldest} → ${finalNewest})`);

      return {
        success: true,
        symbol,
        downloaded: downloaded.length,
        added,
        updated,
        skipped,
        totalArchived: merged.length,
        oldestTimestamp: metadata.oldestTimestamp,
        newestTimestamp: metadata.newestTimestamp
      };

    } catch (error) {
      console.error(`[FootprintArchiver] ❌ Error archivando ${symbol}:`, error);
      return {
        success: false,
        symbol,
        error: error.message
      };
    } finally {
      this.currentSymbol = null;
    }
  }

  /**
   * Archiva todos los símbolos.
   */
  async archiveAll(hours = 168, progressCallback = null) {
    if (this.downloading) {
      console.warn('[FootprintArchiver] Ya hay una descarga en progreso');
      return { success: false, error: 'Descarga en progreso' };
    }

    this.downloading = true;
    this.progress = 0;

    const startTime = Date.now();
    const results = [];
    const daysRequested = (hours / 24).toFixed(1);

    console.log(`[FootprintArchiver] ========================================`);
    console.log(`[FootprintArchiver] 🚀 INICIANDO DESCARGA MASIVA`);
    console.log(`[FootprintArchiver] ========================================`);
    console.log(`[FootprintArchiver] Símbolos: ${this.config.symbols.length}`);
    console.log(`[FootprintArchiver] Horas por símbolo: ${hours}h (~${daysRequested} días)`);
    console.log(`[FootprintArchiver] Intervalo: ${this.config.interval} minuto(s)`);
    console.log(`[FootprintArchiver] Cloud: ${CLOUD_COLLECTOR_URL}`);
    console.log(`[FootprintArchiver] ========================================`);

    for (let i = 0; i < this.config.symbols.length; i++) {
      const symbol = this.config.symbols[i];

      console.log(`\n[FootprintArchiver] ======== SÍMBOLO ${i + 1}/${this.config.symbols.length}: ${symbol} ========`);

      // Reportar progreso
      this.progress = Math.round((i / this.config.symbols.length) * 100);
      if (progressCallback) {
        progressCallback({
          symbol,
          progress: this.progress,
          current: i + 1,
          total: this.config.symbols.length
        });
      }

      // Archivar símbolo
      const symbolStartTime = Date.now();
      const result = await this.archiveSymbol(symbol, hours);
      const symbolDuration = ((Date.now() - symbolStartTime) / 1000).toFixed(1);

      results.push(result);

      if (result.success) {
        console.log(`[FootprintArchiver] ⏱️ ${symbol} completado en ${symbolDuration}s`);
      } else {
        console.log(`[FootprintArchiver] ❌ ${symbol} falló en ${symbolDuration}s: ${result.error}`);
      }

      // Pausa entre símbolos
      if (i < this.config.symbols.length - 1) {
        console.log(`[FootprintArchiver] ⏸️ Pausa de 1 segundo antes del siguiente símbolo...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    this.downloading = false;
    this.progress = 100;

    const duration = Date.now() - startTime;
    const durationMin = (duration / 60000).toFixed(1);
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalDownloaded = results.reduce((sum, r) => sum + (r.downloaded || 0), 0);
    const totalAdded = results.reduce((sum, r) => sum + (r.added || 0), 0);
    const totalUpdated = results.reduce((sum, r) => sum + (r.updated || 0), 0);

    console.log(`\n[FootprintArchiver] ========================================`);
    console.log(`[FootprintArchiver] 🎉 DESCARGA MASIVA COMPLETADA`);
    console.log(`[FootprintArchiver] ========================================`);
    console.log(`[FootprintArchiver] ⏱️ Duración total: ${durationMin} minutos (${(duration / 1000).toFixed(1)}s)`);
    console.log(`[FootprintArchiver] ✅ Exitosos: ${successful}/${this.config.symbols.length}`);
    console.log(`[FootprintArchiver] ❌ Fallidos: ${failed}/${this.config.symbols.length}`);
    console.log(`[FootprintArchiver] 📦 Total descargados: ${totalDownloaded.toLocaleString()} footprints`);
    console.log(`[FootprintArchiver] ➕ Total nuevos agregados: ${totalAdded.toLocaleString()} footprints`);
    console.log(`[FootprintArchiver] 🔄 Total actualizados: ${totalUpdated.toLocaleString()} footprints`);
    console.log(`[FootprintArchiver] ========================================`);

    return {
      success: true,
      duration,
      successful,
      failed,
      totalDownloaded,
      totalAdded,
      results
    };
  }

  /**
   * Obtiene footprints archivados.
   *
   * @param {string} symbol - Símbolo
   * @param {number} fromTimestamp - Desde (opcional)
   * @param {number} toTimestamp - Hasta (opcional)
   * @returns {Promise<Array>} - Footprints
   */
  async getArchivedFootprints(symbol, fromTimestamp = null, toTimestamp = null) {
    const allFootprints = await this._readFromFile(symbol);

    if (!fromTimestamp && !toTimestamp) {
      return allFootprints;
    }

    return allFootprints.filter(fp => {
      const ts = fp.candle_timestamp;

      if (fromTimestamp && ts < fromTimestamp) return false;
      if (toTimestamp && ts > toTimestamp) return false;

      return true;
    });
  }

  /**
   * Obtiene estadísticas del archivo.
   */
  async getArchiveStats() {
    const stats = {
      symbolsArchived: 0,
      totalFootprints: 0,
      oldestTimestamp: null,
      newestTimestamp: null,
      symbolDetails: [],
      storageDir: this.storageDir
    };

    for (const symbol of this.config.symbols) {
      try {
        const footprints = await this._readFromFile(symbol);

        if (footprints.length > 0) {
          const timestamps = footprints.map(fp => fp.candle_timestamp).sort((a, b) => a - b);

          const detail = {
            symbol,
            totalFootprints: footprints.length,
            oldestTimestamp: timestamps[0],
            newestTimestamp: timestamps[timestamps.length - 1]
          };

          stats.symbolDetails.push(detail);
          stats.symbolsArchived++;
          stats.totalFootprints += footprints.length;

          if (!stats.oldestTimestamp || timestamps[0] < stats.oldestTimestamp) {
            stats.oldestTimestamp = timestamps[0];
          }

          if (!stats.newestTimestamp || timestamps[timestamps.length - 1] > stats.newestTimestamp) {
            stats.newestTimestamp = timestamps[timestamps.length - 1];
          }
        }

      } catch (error) {
        console.error(`[FootprintArchiver] Error obteniendo stats de ${symbol}:`, error);
      }
    }

    return stats;
  }

  /**
   * Exporta footprints a JSON.
   */
  async exportToJSON(symbol, fromTimestamp = null, toTimestamp = null) {
    const footprints = await this.getArchivedFootprints(symbol, fromTimestamp, toTimestamp);

    const exportData = {
      symbol,
      interval: this.config.interval,
      exportDate: Date.now(),
      count: footprints.length,
      fromTimestamp,
      toTimestamp,
      footprints
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });

    console.log(`[FootprintArchiver] Exportados ${footprints.length} footprints de ${symbol} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);

    return blob;
  }

  /**
   * Elimina el archivo de footprints de un símbolo específico.
   * Útil cuando se cambia step_size y se necesita regenrar datos desde cero.
   *
   * @param {string} symbol - Símbolo del archivo a eliminar
   * @returns {Promise<Object>} - Resultado de la operación
   */
  async deleteArchiveFile(symbol) {
    if (!window.electron || !this.storageDir) {
      return {
        success: false,
        error: 'Electron API no disponible'
      };
    }

    try {
      const filePath = this._getFilePath(symbol);
      const exists = await window.electron.fileExists(filePath);

      if (!exists) {
        console.log(`[FootprintArchiver] ${symbol}: archivo no existe, nada que eliminar`);
        return {
          success: true,
          message: 'Archivo no existía'
        };
      }

      // Eliminar archivo usando la API de Electron
      await window.electron.deleteFile(filePath);

      console.log(`[FootprintArchiver] 🗑️ ${symbol}: archivo eliminado: ${filePath}`);

      return {
        success: true,
        message: `Archivo ${symbol}_${this.config.interval}.json eliminado`,
        filePath
      };

    } catch (error) {
      console.error(`[FootprintArchiver] ❌ Error eliminando archivo de ${symbol}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Abre la carpeta de almacenamiento en el explorador.
   */
  async openStorageFolder() {
    if (window.electron && this.storageDir) {
      await window.electron.openFolder(this.storageDir);
    }
  }
}

// Singleton
let archiverInstance = null;

export const getFootprintArchiver = () => {
  if (!archiverInstance) {
    archiverInstance = new FootprintArchiverElectron();
  }
  return archiverInstance;
};

export default FootprintArchiverElectron;
