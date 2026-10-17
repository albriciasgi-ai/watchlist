// FootprintArchiver.js - Servicio para descargar y archivar footprints históricos
//
// Descarga footprints del cloud collector y los almacena localmente en formato comprimido.
// Permite construir una biblioteca histórica permanente para backtesting.

import { openDB } from 'idb';

const ARCHIVE_DB_NAME = 'FootprintArchive';
const ARCHIVE_DB_VERSION = 1;
const CLOUD_COLLECTOR_URL = "https://p01--altagracia--rxv8nrbhxln9.code.run";

class FootprintArchiver {
  constructor() {
    this.db = null;
    this.downloading = false;
    this.progress = 0;
    this.currentSymbol = null;

    // Configuración
    this.config = {
      symbols: [
        'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT',
        'TRXUSDT', 'DOGEUSDT', 'BNBUSDT', 'AVAXUSDT', 'ARBUSDT'
      ],
      interval: '1',
      maxHoursPerRequest: 168, // 1 semana por request
      timeout: 120000, // 2 minutos
    };

    this._initDB();
  }

  /**
   * Inicializa la base de datos IndexedDB para el archivo.
   */
  async _initDB() {
    try {
      this.db = await openDB(ARCHIVE_DB_NAME, ARCHIVE_DB_VERSION, {
        upgrade(db) {
          // Store para footprints archivados
          if (!db.objectStoreNames.contains('footprints')) {
            const footprintStore = db.createObjectStore('footprints', {
              keyPath: ['symbol', 'candle_timestamp']
            });
            footprintStore.createIndex('symbol', 'symbol', { unique: false });
            footprintStore.createIndex('timestamp', 'candle_timestamp', { unique: false });
            footprintStore.createIndex('symbol_timestamp', ['symbol', 'candle_timestamp'], { unique: true });
          }

          // Store para metadata de archivos
          if (!db.objectStoreNames.contains('metadata')) {
            const metaStore = db.createObjectStore('metadata', { keyPath: 'id' });
            metaStore.createIndex('symbol', 'symbol', { unique: false });
          }

          // Store para configuración de archivado
          if (!db.objectStoreNames.contains('config')) {
            db.createObjectStore('config', { keyPath: 'key' });
          }
        },
      });

      console.log('[FootprintArchiver] IndexedDB inicializada');
    } catch (error) {
      console.error('[FootprintArchiver] Error inicializando DB:', error);
    }
  }

  /**
   * Descarga footprints del cloud collector.
   *
   * @param {string} symbol - Símbolo a descargar
   * @param {number} hours - Horas de histórico a descargar
   * @returns {Promise<Array>} - Footprints descargados
   */
  async _fetchFromCloud(symbol, hours) {
    const url = `${CLOUD_COLLECTOR_URL}/api/footprints/${symbol}`;
    const params = new URLSearchParams({
      hours: hours.toString(),
      interval: this.config.interval
    });

    console.log(`[FootprintArchiver] Descargando ${symbol}: ${hours} horas desde cloud...`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${url}?${params}`, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const footprints = data.footprints || [];

      console.log(`[FootprintArchiver] ${symbol}: ${footprints.length} footprints descargados`);

      return footprints;

    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        console.warn(`[FootprintArchiver] Timeout descargando ${symbol}`);
      } else {
        console.error(`[FootprintArchiver] Error descargando ${symbol}:`, error);
      }

      return [];
    }
  }

  /**
   * Guarda footprints en el archivo local.
   *
   * @param {string} symbol - Símbolo
   * @param {Array} footprints - Footprints a guardar
   * @returns {Promise<Object>} - Estadísticas de guardado
   */
  async _saveToArchive(symbol, footprints) {
    if (!this.db) {
      await this._initDB();
    }

    const tx = this.db.transaction('footprints', 'readwrite');
    const store = tx.objectStore('footprints');

    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const fp of footprints) {
      try {
        // Verificar si ya existe
        const existing = await store.get([symbol, fp.candle_timestamp]);

        if (existing) {
          // Actualizar si es diferente
          if (JSON.stringify(existing) !== JSON.stringify(fp)) {
            await store.put(fp);
            updated++;
          } else {
            skipped++;
          }
        } else {
          // Agregar nuevo
          await store.add(fp);
          added++;
        }

      } catch (error) {
        console.error(`[FootprintArchiver] Error guardando footprint:`, error);
      }
    }

    await tx.done;

    console.log(`[FootprintArchiver] ${symbol}: +${added} nuevos, ~${updated} actualizados, =${skipped} sin cambios`);

    return { added, updated, skipped, total: footprints.length };
  }

  /**
   * Actualiza metadata de archivo para un símbolo.
   *
   * @param {string} symbol - Símbolo
   * @param {Object} stats - Estadísticas de descarga
   */
  async _updateMetadata(symbol, stats) {
    if (!this.db) return;

    const now = Date.now();

    const metadata = {
      id: `${symbol}_archive`,
      symbol: symbol,
      lastDownload: now,
      totalFootprints: stats.added + stats.updated + stats.skipped,
      lastAdded: stats.added,
      lastUpdated: stats.updated,
      oldestTimestamp: stats.oldestTimestamp,
      newestTimestamp: stats.newestTimestamp,
    };

    const tx = this.db.transaction('metadata', 'readwrite');
    await tx.store.put(metadata);
    await tx.done;
  }

  /**
   * Descarga y archiva footprints de un símbolo.
   *
   * @param {string} symbol - Símbolo a archivar
   * @param {number} hours - Horas a descargar (default: 168 = 1 semana)
   * @returns {Promise<Object>} - Resultado de la operación
   */
  async archiveSymbol(symbol, hours = 168) {
    console.log(`[FootprintArchiver] 📥 Archivando ${symbol}...`);

    this.currentSymbol = symbol;

    try {
      // 1. Descargar desde cloud
      const footprints = await this._fetchFromCloud(symbol, hours);

      if (footprints.length === 0) {
        return {
          success: false,
          symbol,
          error: 'No hay datos disponibles en el cloud collector'
        };
      }

      // 2. Guardar en archivo local
      const saveStats = await this._saveToArchive(symbol, footprints);

      // 3. Calcular timestamps
      const timestamps = footprints.map(fp => fp.candle_timestamp).sort((a, b) => a - b);
      const oldestTimestamp = timestamps[0];
      const newestTimestamp = timestamps[timestamps.length - 1];

      // 4. Actualizar metadata
      await this._updateMetadata(symbol, {
        ...saveStats,
        oldestTimestamp,
        newestTimestamp
      });

      return {
        success: true,
        symbol,
        downloaded: footprints.length,
        added: saveStats.added,
        updated: saveStats.updated,
        skipped: saveStats.skipped,
        oldestTimestamp,
        newestTimestamp
      };

    } catch (error) {
      console.error(`[FootprintArchiver] Error archivando ${symbol}:`, error);
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
   * Descarga y archiva todos los símbolos configurados.
   *
   * @param {number} hours - Horas a descargar por símbolo
   * @param {Function} progressCallback - Callback para reportar progreso
   * @returns {Promise<Object>} - Resultados de la operación
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

    console.log(`[FootprintArchiver] 🚀 Iniciando archivo de ${this.config.symbols.length} símbolos...`);

    for (let i = 0; i < this.config.symbols.length; i++) {
      const symbol = this.config.symbols[i];

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
      const result = await this.archiveSymbol(symbol, hours);
      results.push(result);

      // Pausa breve entre símbolos para no saturar el servidor
      if (i < this.config.symbols.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    this.downloading = false;
    this.progress = 100;

    const duration = Date.now() - startTime;
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalDownloaded = results.reduce((sum, r) => sum + (r.downloaded || 0), 0);
    const totalAdded = results.reduce((sum, r) => sum + (r.added || 0), 0);

    console.log(`[FootprintArchiver] ✅ Archivo completado en ${(duration / 1000).toFixed(1)}s`);
    console.log(`[FootprintArchiver] Exitosos: ${successful}, Fallidos: ${failed}`);
    console.log(`[FootprintArchiver] Total descargados: ${totalDownloaded}, Total nuevos: ${totalAdded}`);

    // Guardar timestamp de última ejecución completa
    await this._saveLastRun(Date.now(), successful, failed, totalAdded);

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
   * Guarda timestamp de la última ejecución completa.
   */
  async _saveLastRun(timestamp, successful, failed, totalAdded) {
    if (!this.db) return;

    const tx = this.db.transaction('config', 'readwrite');
    await tx.store.put({
      key: 'last_archive_run',
      timestamp,
      successful,
      failed,
      totalAdded
    });
    await tx.done;
  }

  /**
   * Obtiene footprints archivados de un símbolo.
   *
   * @param {string} symbol - Símbolo
   * @param {number} fromTimestamp - Timestamp inicial (opcional)
   * @param {number} toTimestamp - Timestamp final (opcional)
   * @returns {Promise<Array>} - Footprints del archivo
   */
  async getArchivedFootprints(symbol, fromTimestamp = null, toTimestamp = null) {
    if (!this.db) {
      await this._initDB();
    }

    const tx = this.db.transaction('footprints', 'readonly');
    const index = tx.store.index('symbol_timestamp');

    let footprints = [];

    if (fromTimestamp && toTimestamp) {
      // Rango específico
      const range = IDBKeyRange.bound(
        [symbol, fromTimestamp],
        [symbol, toTimestamp]
      );
      footprints = await index.getAll(range);
    } else {
      // Todos del símbolo
      const range = IDBKeyRange.bound(
        [symbol, 0],
        [symbol, Infinity]
      );
      footprints = await index.getAll(range);
    }

    await tx.done;

    console.log(`[FootprintArchiver] ${symbol}: ${footprints.length} footprints del archivo`);

    return footprints;
  }

  /**
   * Obtiene metadata de archivo de un símbolo.
   *
   * @param {string} symbol - Símbolo
   * @returns {Promise<Object>} - Metadata
   */
  async getMetadata(symbol) {
    if (!this.db) {
      await this._initDB();
    }

    const tx = this.db.transaction('metadata', 'readonly');
    const metadata = await tx.store.get(`${symbol}_archive`);
    await tx.done;

    return metadata || null;
  }

  /**
   * Obtiene estadísticas del archivo completo.
   *
   * @returns {Promise<Object>} - Estadísticas
   */
  async getArchiveStats() {
    if (!this.db) {
      await this._initDB();
    }

    const tx = this.db.transaction(['metadata', 'config'], 'readonly');

    const allMeta = await tx.objectStore('metadata').getAll();
    const lastRun = await tx.objectStore('config').get('last_archive_run');

    await tx.done;

    const totalFootprints = allMeta.reduce((sum, m) => sum + (m.totalFootprints || 0), 0);
    const symbolsArchived = allMeta.length;

    // Calcular rango global de fechas
    const timestamps = allMeta
      .filter(m => m.oldestTimestamp && m.newestTimestamp)
      .flatMap(m => [m.oldestTimestamp, m.newestTimestamp]);

    const oldestGlobal = timestamps.length > 0 ? Math.min(...timestamps) : null;
    const newestGlobal = timestamps.length > 0 ? Math.max(...timestamps) : null;

    return {
      symbolsArchived,
      totalFootprints,
      oldestTimestamp: oldestGlobal,
      newestTimestamp: newestGlobal,
      lastRun: lastRun || null,
      symbolDetails: allMeta
    };
  }

  /**
   * Elimina footprints archivados más antiguos que una fecha.
   *
   * @param {string} symbol - Símbolo (o null para todos)
   * @param {number} beforeTimestamp - Eliminar anteriores a este timestamp
   * @returns {Promise<number>} - Número de footprints eliminados
   */
  async deleteOldFootprints(symbol = null, beforeTimestamp) {
    if (!this.db) {
      await this._initDB();
    }

    const tx = this.db.transaction('footprints', 'readwrite');
    const store = tx.store;
    const index = symbol ? store.index('symbol_timestamp') : store.index('timestamp');

    let deleted = 0;

    if (symbol) {
      // Eliminar de un símbolo específico
      const range = IDBKeyRange.bound(
        [symbol, 0],
        [symbol, beforeTimestamp]
      );

      let cursor = await index.openCursor(range);

      while (cursor) {
        await cursor.delete();
        deleted++;
        cursor = await cursor.continue();
      }
    } else {
      // Eliminar de todos los símbolos
      const range = IDBKeyRange.upperBound(beforeTimestamp);

      let cursor = await index.openCursor(range);

      while (cursor) {
        await cursor.delete();
        deleted++;
        cursor = await cursor.continue();
      }
    }

    await tx.done;

    console.log(`[FootprintArchiver] Eliminados ${deleted} footprints antiguos`);

    return deleted;
  }

  /**
   * Exporta footprints a formato JSON comprimido para backup externo.
   *
   * @param {string} symbol - Símbolo a exportar
   * @param {number} fromTimestamp - Desde (opcional)
   * @param {number} toTimestamp - Hasta (opcional)
   * @returns {Promise<Blob>} - Blob con datos JSON
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

    const jsonString = JSON.stringify(exportData);
    const blob = new Blob([jsonString], { type: 'application/json' });

    console.log(`[FootprintArchiver] Exportados ${footprints.length} footprints de ${symbol} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);

    return blob;
  }
}

// Singleton instance
let archiverInstance = null;

export const getFootprintArchiver = () => {
  if (!archiverInstance) {
    archiverInstance = new FootprintArchiver();
  }
  return archiverInstance;
};

export default FootprintArchiver;
