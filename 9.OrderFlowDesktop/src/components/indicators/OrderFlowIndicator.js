// src/components/indicators/OrderFlowIndicator.js

import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';
import pollingCoordinator from '../../utils/PollingCoordinator.js';
import { getFootprintArchiver } from '../../services/FootprintArchiverElectron.js';

/**
 * OrderFlowIndicator - Professional Footprint Chart Visualization
 *
 * Each candle unit consists of (left to right):
 * 1. Japanese Candle (thin, traditional)
 * 2. Volume Profile (horizontal bars per level)
 * 3. Footprint (bid|ask volumes per level)
 *
 * The entire unit scales proportionally with zoom.
 * This indicator REPLACES Japanese candles when enabled.
 */
class OrderFlowIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 1) {
    super(symbol, interval, days);
    this.name = "Order Flow";
    this.footprints = [];
    this.config = this.loadConfig();
    this.height = 0; // Overlay on main chart

    console.log(`[OrderFlow] [${symbol}] CONSTRUCTOR: interval=${interval}, days=${days}, historyHours=${this.config.historyHours}`);
    this._instanceId = `${symbol}_${Date.now()}`; // ID unico para tracking

    // Polling settings
    this.lastFetchTime = 0;
    this.fetchIntervalMs = 5000;
    this.isFetching = false;
    this._pollingId = null; // ✅ OPTIMIZADO: Usa PollingCoordinator en lugar de setInterval
    this._destroyed = false;

    // Retry settings for initial fetch
    this._retryCount = 0;
    this._maxRetries = 5;
    this._retryDelayMs = 2000; // Start with 2 seconds
    this._retryTimeoutId = null;


    // Layout proportions (as fractions of total candle width)
    // Order: Candle | Footprint (bid|ask) | Volume Profile
    this.layout = {
      candlePct: 0.20,      // 20% for Japanese candle (doubled from 10%)
      footprintPct: 0.28,   // 28% for footprint (bid|ask) (halved from 55%)
      profilePct: 0.47,     // 47% for volume profile (rightmost)
      gapPct: 0.05          // 5% gaps between elements
    };

    // Colors
    this.colors = {
      // Volume Profile
      PROFILE_BAR: 'rgba(100, 149, 237, 0.7)',  // Cornflower blue
      PROFILE_POC: 'rgba(255, 215, 0, 0.9)',    // Gold for POC

      // Footprint backgrounds
      BID_BG_STRONG: 'rgba(183, 28, 28, 0.85)',   // Dark red
      BID_BG_WEAK: 'rgba(239, 154, 154, 0.6)',    // Light red
      ASK_BG_STRONG: 'rgba(27, 94, 32, 0.85)',    // Dark green
      ASK_BG_WEAK: 'rgba(165, 214, 167, 0.6)',    // Light green

      // Text
      TEXT: '#FFFFFF',
      TEXT_SHADOW: '#000000',

      // Candle colors
      CANDLE_UP: '#26A69A',
      CANDLE_DOWN: '#EF5350',
      CANDLE_WICK: '#666666',

      // POC and imbalances
      POC_LINE: '#FFD700',
      IMBALANCE_BORDER: '#FFD600'
    };

  }

  loadConfig() {
    const saved = localStorage.getItem(`orderflow_config_${this.symbol}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Merge with defaults to ensure all new properties exist
        const defaults = this.getDefaultConfig();
        const merged = { ...defaults, ...parsed };
        // Force enabled if it was somehow disabled
        merged.enabled = true;
        // Always force minCandleWidth to default (8) - old persisted values (15, 20) block rendering
        merged.minCandleWidth = defaults.minCandleWidth;
        if (merged.minCandleWidthFull === 80) {
          merged.minCandleWidthFull = defaults.minCandleWidthFull;
        }
        // Force update historyHours if it was set to old value (12)
        if (merged.historyHours === 12) {
          merged.historyHours = defaults.historyHours;
        }
        // Force timestampToleranceMs if missing (fix para footprints históricos)
        if (!merged.timestampToleranceMs) {
          merged.timestampToleranceMs = defaults.timestampToleranceMs;
        }
        return merged;
      } catch (e) {
        // Config parse error - use defaults
      }
    }
    return this.getDefaultConfig();
  }

  getDefaultConfig() {
    return {
      enabled: true,
      showCandle: true,       // Show Japanese candle
      showProfile: true,      // Show volume profile
      showFootprint: true,    // Show bid/ask footprint
      showPOC: true,          // Highlight POC level
      showImbalances: true,   // Highlight imbalances
      showDelta: true,        // Show delta at bottom
      fontSize: 9,            // Slightly smaller font
      minCandleWidth: 8,      // Minimum width for basic display (reduced from 15)
      minCandleWidthFull: 60, // Width needed for full text display (reduced from 80)
      opacity: 0.9,
      historyHours: 24,       // Horas de historico de footprints (aumentado de 12 a 24)
      stackedLineWidth: 2,    // Grosor de lineas de stacked imbalance (1-6)
      stackedLineExtend: 3,   // Multiplicador de extension de linea (1=ancho vela, 5=5x ancho vela)
      stackedBuyColor: '38,166,154',   // RGB del color BUY (verde)
      stackedSellColor: '239,83,80',   // RGB del color SELL (rojo)
      stackedOpacity: 0.7,     // Opacidad de las lineas stacked (0.1 - 1.0)
      stackedMinVolumeZScore: 0, // Filtro minimo de volume z-score para stacked (0 = sin filtro)
      timestampToleranceMs: 30000 // Tolerancia para matching de timestamps vela-footprint (30 segundos)
    };
  }

  updateConfig(config) {
    this.config = { ...this.config, ...config };
    localStorage.setItem(`orderflow_config_${this.symbol}`, JSON.stringify(this.config));
  }

  setInterval(newInterval) {
    const oldInterval = this.interval;
    const oldCount = this.footprints.length;
    this.interval = newInterval;
    this.footprints = [];
    console.log(`[OrderFlow] [${this.symbol}] setInterval: ${oldInterval} -> ${newInterval} (footprints cleared: ${oldCount} -> 0)`);
  }

  async fetchData() {
    if (this._destroyed) return false;
    const success = await this.fetchFootprints();
    return success;
  }

  startPollingIfReady() {
    if (this._destroyed) return;
    if (!this._pollingInterval && this.enabled && this.config.enabled) {
      this._startPolling();
    }
  }

  // ✅ OPTIMIZADO: Usa PollingCoordinator centralizado (ahorra ~50MB/24h)
  _startPolling() {
    if (this._pollingId) return; // Ya registrado

    this._pollingId = pollingCoordinator.register(
      `OrderFlow_${this.symbol}`,
      async () => {
        if (this._destroyed) {
          this.stopPolling();
          return;
        }
        if (this.enabled && this.config.enabled) {
          const updated = await this.fetchFootprints();
          if (updated && this.indicatorManager?.requestRedraw) {
            this.indicatorManager.requestRedraw();
          }
        }
      },
      this.fetchIntervalMs,
      1 // Alta prioridad (Order Flow es critico)
    );
  }

  stopPolling() {
    if (this._pollingId) {
      pollingCoordinator.unregister(this._pollingId);
      this._pollingId = null;
    }
  }

  destroy() {
    console.log(`[OrderFlow] [${this.symbol}] DESTROY: instanceId=${this._instanceId}, footprints=${this.footprints.length}`);
    this._destroyed = true;
    this.stopPolling();
    // Cancel any pending retry
    if (this._retryTimeoutId) {
      clearTimeout(this._retryTimeoutId);
      this._retryTimeoutId = null;
    }
  }

  /**
   * Carga footprints desde el archivo local (fallback cuando backend no tiene datos)
   */
  /**
   * Agrega footprints de 1 minuto a intervalos mayores (5min, 15min, 1h, etc.)
   *
   * IMPORTANTE: Maneja dos formatos de footprints:
   * - Formato archivo: candle_open/high/low/close, levels[] con price_mid
   * - Formato backend: open/high/low/close, price_levels[] con price
   *
   * @param {Array} footprints1min - Footprints de 1 minuto
   * @param {string} targetInterval - Intervalo objetivo ("5", "15", "60", etc.)
   * @returns {Array} - Footprints agregados
   */
  _aggregateFootprints(footprints1min, targetInterval) {
    if (targetInterval === "1") {
      return footprints1min; // No agregar si ya es 1min
    }

    const intervalMinutes = parseInt(targetInterval);
    if (isNaN(intervalMinutes)) {
      console.error(`[OrderFlow] [${this.symbol}] _aggregateFootprints: intervalo inválido ${targetInterval}`);
      return [];
    }

    console.log(`[OrderFlow] [${this.symbol}] 🔄 Agregando ${footprints1min.length} footprints de 1min a ${intervalMinutes}min`);

    // 🔍 DEBUG: Inspeccionar estructura del primer footprint
    if (footprints1min.length > 0) {
      const sample = footprints1min[0];
      const sampleLevels = sample.levels || sample.price_levels || [];
      const sampleLevel = sampleLevels[0];

      console.log(`[OrderFlow] [${this.symbol}] 🔍 MUESTRA FP 1MIN:`, {
        fpKeys: Object.keys(sample).join(', '),
        levelCount: sampleLevels.length,
        level0: sampleLevel ? {
          keys: Object.keys(sampleLevel).join(', '),
          bid_volume: sampleLevel.bid_volume,
          ask_volume: sampleLevel.ask_volume,
          buyVolume: sampleLevel.buyVolume,
          sellVolume: sampleLevel.sellVolume,
          buy_volume: sampleLevel.buy_volume,
          sell_volume: sampleLevel.sell_volume
        } : null
      });
    }

    // Agrupar por intervalo
    const groups = new Map();

    for (const fp of footprints1min) {
      // Redondear timestamp al inicio del intervalo
      const timestamp = fp.candle_timestamp;
      const intervalStart = Math.floor(timestamp / (intervalMinutes * 60 * 1000)) * (intervalMinutes * 60 * 1000);

      if (!groups.has(intervalStart)) {
        groups.set(intervalStart, []);
      }
      groups.get(intervalStart).push(fp);
    }

    // Agregar cada grupo
    const aggregated = [];

    for (const [intervalStart, groupFootprints] of groups) {
      if (groupFootprints.length === 0) continue;

      // Combinar todos los price_levels de los footprints del grupo
      const combinedLevels = new Map();

      for (const fp of groupFootprints) {
        // Soportar ambos formatos: levels[] (archivo) y price_levels[] (backend)
        const levels = fp.levels || fp.price_levels || [];

        // 🔍 DEBUG: Ver estructura del primer level del archivo
        if (!this._loggedArchiveLevel && levels.length > 0) {
          this._loggedArchiveLevel = true;
          console.log(`[OrderFlow] [${this.symbol}] 🔍 NIVEL ARCHIVO (primer fp, primer level):`, {
            allKeys: Object.keys(levels[0]),
            sample: levels[0]
          });
        }

        for (const level of levels) {
          // Soportar price_mid (archivo) y price (backend)
          const price = level.price_mid || level.price;

          if (!combinedLevels.has(price)) {
            // ✅ CREAR LEVEL preservando price_min/max del nivel original
            combinedLevels.set(price, {
              price: price,
              price_min: level.price_min || price,  // ✅ Preservar rango original
              price_max: level.price_max || price,  // ✅ Preservar rango original
              price_mid: price,
              bid_volume: 0,
              ask_volume: 0,
              total_volume: 0,
              delta: 0
            });
          }

          const combined = combinedLevels.get(price);
          // ✅ Expandir el rango de precio para incluir este nivel
          if (level.price_min != null && level.price_min < combined.price_min) {
            combined.price_min = level.price_min;
          }
          if (level.price_max != null && level.price_max > combined.price_max) {
            combined.price_max = level.price_max;
          }

          combined.bid_volume += level.bid_volume || 0;
          combined.ask_volume += level.ask_volume || 0;
          combined.total_volume += level.total_volume || 0;
          combined.delta += level.delta || 0;
        }
      }

      // Convertir Map a Array y ordenar por precio descendente
      const levels = Array.from(combinedLevels.values()).sort((a, b) => b.price - a.price);

      // 🔍 DEBUG: Verificar volúmenes del primer nivel agregado (solo primer footprint agregado)
      if (aggregated.length === 0 && levels.length > 0) {
        console.log(`[OrderFlow] [${this.symbol}] 🔍 NIVEL AGREGADO (primer nivel del primer FP):`, {
          price: levels[0].price,
          price_min: levels[0].price_min,
          price_max: levels[0].price_max,
          bid_volume: levels[0].bid_volume,
          ask_volume: levels[0].ask_volume,
          total_volume: levels[0].total_volume,
          allKeys: Object.keys(levels[0]).join(', ')
        });
      }

      // Calcular OHLC del intervalo agregado
      // Soportar candle_open/high/low/close (archivo) y open/high/low/close (backend)
      const candle_open = groupFootprints[0].candle_open || groupFootprints[0].open;
      const candle_close = groupFootprints[groupFootprints.length - 1].candle_close || groupFootprints[groupFootprints.length - 1].close;
      const candle_high = Math.max(...groupFootprints.map(fp => fp.candle_high || fp.high));
      const candle_low = Math.min(...groupFootprints.map(fp => fp.candle_low || fp.low));

      // Sumar volúmenes totales
      const total_volume = groupFootprints.reduce((sum, fp) => sum + (fp.total_volume || 0), 0);

      // Calcular delta total sumando deltas individuales de los footprints
      const total_delta = groupFootprints.reduce((sum, fp) => sum + (fp.total_delta || fp.delta || 0), 0);

      // Calcular POC (Point of Control) - nivel con mayor volumen Y su índice
      let poc = null;
      let poc_index = -1;
      let max_volume = 0;
      for (let i = 0; i < levels.length; i++) {
        const level = levels[i];
        if (level.total_volume > max_volume) {
          max_volume = level.total_volume;
          poc = level.price;
          poc_index = i;  // ✅ Guardar el índice del POC
        }
      }

      // ✅ NORMALIZAR AL FORMATO DEL BACKEND (con campo "levels" en lugar de "price_levels")
      const aggregatedFootprint = {
        candle_timestamp: intervalStart,
        symbol: this.symbol,
        interval: targetInterval,
        candle_open,
        candle_high,
        candle_low,
        candle_close,
        step_size: 0.1, // Default step size
        levels,  // ✅ Campo "levels" (no "price_levels")
        num_levels: levels.length,
        total_volume,
        total_delta,
        delta: total_delta,
        poc,
        poc_index  // ✅ Agregar poc_index para renderizado completo
      };

      aggregated.push(aggregatedFootprint);
    }

    // Ordenar por timestamp
    aggregated.sort((a, b) => a.candle_timestamp - b.candle_timestamp);

    console.log(`[OrderFlow] [${this.symbol}] ✅ Agregación completa: ${aggregated.length} footprints de ${intervalMinutes}min (formato normalizado con campo "levels")`);

    return aggregated;
  }

  async _loadFromArchive() {
    console.log(`[OrderFlow] [${this.symbol}] 🔍 _loadFromArchive INICIADO`);
    console.log(`[OrderFlow] [${this.symbol}] 🔍 window.electron=${!!window.electron}, getUserDataPath=${!!window.electron?.getUserDataPath}, readFile=${!!window.electron?.readFile}, fileExists=${!!window.electron?.fileExists}`);

    try {
      // Verificar que window.electron existe
      if (!window.electron || !window.electron.getUserDataPath || !window.electron.readFile || !window.electron.fileExists) {
        console.warn(`[OrderFlow] [${this.symbol}] ❌ _loadFromArchive: Electron APIs no disponibles`);
        return [];
      }

      const userDataPath = await window.electron.getUserDataPath();
      console.log(`[OrderFlow] [${this.symbol}] 🔍 userDataPath obtenido: ${userDataPath}`);

      const archivePath = `${userDataPath}/footprint_archive/${this.symbol}_1.json`;
      console.log(`[OrderFlow] [${this.symbol}] 🔍 Verificando archivo: ${archivePath}`);

      const exists = await window.electron.fileExists(archivePath);
      console.log(`[OrderFlow] [${this.symbol}] 🔍 Archivo existe: ${exists}`);

      if (!exists) {
        console.warn(`[OrderFlow] [${this.symbol}] ❌ _loadFromArchive: archivo no existe: ${archivePath}`);
        return [];
      }

      console.log(`[OrderFlow] [${this.symbol}] ✅ Archivo existe, leyendo...`);

      const content = await window.electron.readFile(archivePath);
      console.log(`[OrderFlow] [${this.symbol}] 🔍 Contenido leído: ${content.length} caracteres`);

      const data = JSON.parse(content);
      const footprints1min = data.footprints || [];

      console.log(`[OrderFlow] [${this.symbol}] 📚 Cargados ${footprints1min.length} footprints de 1min desde archivo local`);

      // 🔍 DIAGNOSTICO: Verificar rango temporal del archivo
      if (footprints1min.length > 0) {
        const firstFp = footprints1min[0];
        const lastFp = footprints1min[footprints1min.length - 1];
        const firstDate = new Date(firstFp.candle_timestamp).toLocaleString('es-ES');
        const lastDate = new Date(lastFp.candle_timestamp).toLocaleString('es-ES');
        const rangeHours = ((lastFp.candle_timestamp - firstFp.candle_timestamp) / (1000 * 60 * 60)).toFixed(1);

        console.log(`[OrderFlow] [${this.symbol}] 🔍 ARCHIVO 1min RANGO:`);
        console.log(`[OrderFlow] [${this.symbol}]   • Desde: ${firstDate} (ts: ${firstFp.candle_timestamp})`);
        console.log(`[OrderFlow] [${this.symbol}]   • Hasta: ${lastDate} (ts: ${lastFp.candle_timestamp})`);
        console.log(`[OrderFlow] [${this.symbol}]   • Duración: ${rangeHours} horas (~${(rangeHours / 24).toFixed(1)} días)`);
        console.log(`[OrderFlow] [${this.symbol}]   • Footprints: ${footprints1min.length} de 1min`);
      }

      // ✅ AUTO-CHECK: Verificar si el archivo está desactualizado y descargar automáticamente
      if (footprints1min.length > 0) {
        const lastFp = footprints1min[footprints1min.length - 1];
        const lastTimestamp = lastFp.candle_timestamp;
        const now = Date.now();
        const ageHours = (now - lastTimestamp) / (1000 * 60 * 60);

        // Si el archivo tiene más de 12 horas de antigüedad, descargar automáticamente
        if (ageHours > 12) {
          const lastDate = new Date(lastTimestamp).toLocaleString('es-ES');
          console.warn(`[OrderFlow] [${this.symbol}] ⚠️ ARCHIVO DESACTUALIZADO: último footprint de ${lastDate} (${ageHours.toFixed(1)}h de antigüedad)`);
          console.log(`[OrderFlow] [${this.symbol}] 🔄 Descargando footprints actualizados automáticamente...`);

          // Descargar en background (no esperar)
          this._autoDownloadArchive().catch(err => {
            console.error(`[OrderFlow] [${this.symbol}] ❌ Auto-descarga falló: ${err.message}`);
          });
        }
      }

      // Si el intervalo no es 1min, agregar los footprints
      if (this.interval !== "1") {
        console.log(`[OrderFlow] [${this.symbol}] 🔍 Agregando de 1min a ${this.interval}min...`);
        const aggregated = this._aggregateFootprints(footprints1min, this.interval);
        console.log(`[OrderFlow] [${this.symbol}] 🔍 Agregación retorna: ${aggregated.length} footprints de ${this.interval}min`);

        // 🔍 DIAGNOSTICO: Verificar rango temporal después de agregar
        if (aggregated.length > 0) {
          const firstAgg = aggregated[0];
          const lastAgg = aggregated[aggregated.length - 1];
          const firstDateAgg = new Date(firstAgg.candle_timestamp).toLocaleString('es-ES');
          const lastDateAgg = new Date(lastAgg.candle_timestamp).toLocaleString('es-ES');
          const rangeHoursAgg = ((lastAgg.candle_timestamp - firstAgg.candle_timestamp) / (1000 * 60 * 60)).toFixed(1);

          console.log(`[OrderFlow] [${this.symbol}] 🔍 AGREGADO ${this.interval}min RANGO:`);
          console.log(`[OrderFlow] [${this.symbol}]   • Desde: ${firstDateAgg}`);
          console.log(`[OrderFlow] [${this.symbol}]   • Hasta: ${lastDateAgg}`);
          console.log(`[OrderFlow] [${this.symbol}]   • Duración: ${rangeHoursAgg} horas (~${(rangeHoursAgg / 24).toFixed(1)} días)`);
          console.log(`[OrderFlow] [${this.symbol}]   • Footprints: ${aggregated.length} de ${this.interval}min`);
        }

        return aggregated;
      }

      return footprints1min;

    } catch (error) {
      console.error(`[OrderFlow] [${this.symbol}] ❌ _loadFromArchive ERROR: ${error.message}`);
      console.error(`[OrderFlow] [${this.symbol}] ❌ Stack: ${error.stack}`);
      return [];
    }
  }

  /**
   * Descarga automática de footprints actualizados cuando el archivo está desactualizado
   * @returns {Promise<void>}
   */
  async _autoDownloadArchive() {
    try {
      console.log(`[OrderFlow] [${this.symbol}] 🔄 _autoDownloadArchive: Iniciando descarga automática...`);

      // Obtener instancia del archiver
      const archiver = getFootprintArchiver();
      if (!archiver) {
        throw new Error('FootprintArchiver no disponible');
      }

      // Descargar últimas 48 horas para cerrar el gap
      // (archivo viejo + últimas horas del backend = gap en el medio)
      const hoursToDownload = 48;
      console.log(`[OrderFlow] [${this.symbol}] 📥 Descargando últimas ${hoursToDownload}h desde cloud...`);

      const result = await archiver.archiveSymbol(this.symbol, hoursToDownload);

      if (result.success) {
        console.log(`[OrderFlow] [${this.symbol}] ✅ Auto-descarga exitosa: ${result.added || 0} nuevos footprints`);

        // Recargar footprints desde el archivo actualizado
        console.log(`[OrderFlow] [${this.symbol}] 🔄 Recargando footprints desde archivo actualizado...`);
        const updatedFootprints = await this._loadFromArchive();

        if (updatedFootprints.length > 0) {
          console.log(`[OrderFlow] [${this.symbol}] ✅ Archivo actualizado: ${updatedFootprints.length} footprints disponibles`);

          // Forzar recarga completa de datos
          // (esto se manejará en el próximo ciclo de fetchFootprints)
          console.log(`[OrderFlow] [${this.symbol}] 🔄 Datos actualizados, próxima carga usará archivo nuevo`);
        } else {
          console.warn(`[OrderFlow] [${this.symbol}] ⚠️ Archivo actualizado pero sin footprints cargados`);
        }
      } else {
        throw new Error(result.error || 'Descarga falló sin error específico');
      }

    } catch (error) {
      console.error(`[OrderFlow] [${this.symbol}] ❌ _autoDownloadArchive ERROR: ${error.message}`);
      // No lanzar error - esto es un proceso de background
      // El indicador seguirá funcionando con los datos disponibles
    }
  }

  async fetchFootprints() {
    if (this._destroyed) return false;
    if (this.isFetching) return false;

    console.log(`[OrderFlow] [${this.symbol}] 🔍 fetchFootprints INICIADO - interval=${this.interval}`);

    this.isFetching = true;
    this.lastFetchTime = Date.now();

    try {
      const supportedIntervals = ["1", "5"];

      if (!supportedIntervals.includes(this.interval)) {
        console.log(`[OrderFlow] [${this.symbol}] fetchFootprints: interval ${this.interval} not supported (only 1, 5)`);
        this.footprints = [];
        return false;
      }

      // =====================================================================
      // PASO 1: SIEMPRE intentar cargar desde archivo local primero
      // =====================================================================
      console.log(`[OrderFlow] [${this.symbol}] 🔍 PASO 1: Intentando cargar desde archivo...`);
      let archivedFootprints = [];
      try {
        archivedFootprints = await this._loadFromArchive();
        if (archivedFootprints.length > 0) {
          console.log(`[OrderFlow] [${this.symbol}] 📚 Archivo local: ${archivedFootprints.length} footprints cargados`);
        }
      } catch (archiveError) {
        console.warn(`[OrderFlow] [${this.symbol}] No se pudo cargar archivo local: ${archiveError.message}`);
      }

      // =====================================================================
      // PASO 2: Intentar obtener datos del backend
      // =====================================================================
      const hours = this.config.historyHours || 12;
      const url = `${API_BASE_URL}/api/orderflow/footprint/${this.symbol}?interval=${this.interval}&limit=2000&hours=${hours}`;

      // Timeout de 120 segundos para el fetch (cloud service puede tardar)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      let backendFootprints = [];
      let backendFailed = false;

      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        this._retryCount = 0; // Reset retry count on success

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.footprints) {
            backendFootprints = data.footprints;
            console.log(`[OrderFlow] [${this.symbol}] 🌐 Backend: ${backendFootprints.length} footprints recibidos`);

            // 🔍 DIAGNOSTICO: Verificar rango temporal del backend
            if (backendFootprints.length > 0) {
              const firstBe = backendFootprints[0];
              const lastBe = backendFootprints[backendFootprints.length - 1];
              const firstDateBe = new Date(firstBe.candle_timestamp).toLocaleString('es-ES');
              const lastDateBe = new Date(lastBe.candle_timestamp).toLocaleString('es-ES');
              const rangeHoursBe = ((lastBe.candle_timestamp - firstBe.candle_timestamp) / (1000 * 60 * 60)).toFixed(1);

              console.log(`[OrderFlow] [${this.symbol}] 🔍 BACKEND ${this.interval}min RANGO:`);
              console.log(`[OrderFlow] [${this.symbol}]   • Desde: ${firstDateBe}`);
              console.log(`[OrderFlow] [${this.symbol}]   • Hasta: ${lastDateBe}`);
              console.log(`[OrderFlow] [${this.symbol}]   • Duración: ${rangeHoursBe} horas (~${(rangeHoursBe / 24).toFixed(1)} días)`);
              console.log(`[OrderFlow] [${this.symbol}]   • Footprints: ${backendFootprints.length} de ${this.interval}min`);
            }
          } else {
            console.warn(`[OrderFlow] [${this.symbol}] Backend retornó success=false`);
            backendFailed = true;
          }
        } else {
          console.error(`[OrderFlow] [${this.symbol}] Backend HTTP error ${response.status}`);
          backendFailed = true;
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        backendFailed = true;
        console.warn(`[OrderFlow] [${this.symbol}] Backend error: ${fetchError.message}`);
      }

      // =====================================================================
      // PASO 3: Merge inteligente de archivo + backend
      // =====================================================================
      const oldCount = this.footprints.length;
      let finalFootprints = [];

      if (archivedFootprints.length === 0 && backendFootprints.length === 0) {
        // No hay datos de ninguna fuente
        console.warn(`[OrderFlow] [${this.symbol}] ❌ No hay footprints disponibles (ni archivo ni backend)`);

        // Intentar retry si backend falló
        if (backendFailed && this._retryCount < this._maxRetries && !this._destroyed) {
          this._retryCount++;
          const delay = this._retryDelayMs * Math.pow(2, this._retryCount - 1);
          console.log(`[OrderFlow] [${this.symbol}] Scheduling retry ${this._retryCount}/${this._maxRetries} in ${delay}ms`);

          this._retryTimeoutId = setTimeout(async () => {
            if (!this._destroyed) {
              this.isFetching = false;
              const success = await this.fetchFootprints();
              if (success && this.indicatorManager?.requestRedraw) {
                this.indicatorManager.requestRedraw();
              }
            }
          }, delay);
        }

        this.footprints = [];
        return false;

      } else if (archivedFootprints.length > 0 && backendFootprints.length === 0) {
        // Solo archivo disponible
        finalFootprints = archivedFootprints;
        console.log(`[OrderFlow] [${this.symbol}] ✅ Usando solo archivo local (${finalFootprints.length} footprints)`);

      } else if (archivedFootprints.length === 0 && backendFootprints.length > 0) {
        // Solo backend disponible
        finalFootprints = backendFootprints;
        console.log(`[OrderFlow] [${this.symbol}] ✅ Usando solo backend (${finalFootprints.length} footprints)`);

      } else {
        // Ambas fuentes disponibles - MERGE INTELIGENTE
        // Estrategia: Archivo como base completa + backend para agregar/actualizar datos más recientes

        // 1. Usar TODO el archivo como base
        const mergedMap = new Map();
        for (const fp of archivedFootprints) {
          mergedMap.set(fp.candle_timestamp, fp);
        }

        // 2. Agregar footprints del backend que:
        //    a) Sean más recientes que el último del archivo (datos nuevos)
        //    b) O actualicen los últimos 30 footprints del archivo (datos más frescos)

        const archiveNewestTs = archivedFootprints.length > 0
          ? archivedFootprints[archivedFootprints.length - 1].candle_timestamp
          : 0;

        const updateThresholdTs = archiveNewestTs - (30 * 5 * 60 * 1000); // últimos 2.5h del archivo

        let backendUpdated = 0;
        let backendAdded = 0;
        let backendIgnored = 0;

        for (const fp of backendFootprints) {
          if (fp.candle_timestamp > archiveNewestTs) {
            // Footprint más nuevo que el archivo → agregar
            mergedMap.set(fp.candle_timestamp, fp);
            backendAdded++;
          } else if (fp.candle_timestamp >= updateThresholdTs) {
            // Footprint en el rango de actualización → sobrescribir
            mergedMap.set(fp.candle_timestamp, fp);
            backendUpdated++;
          } else {
            // Footprint más viejo que el rango de actualización → ignorar (el archivo tiene mejor cobertura)
            backendIgnored++;
          }
        }

        // 3. Convertir a array y ordenar
        finalFootprints = Array.from(mergedMap.values()).sort((a, b) => a.candle_timestamp - b.candle_timestamp);

        console.log(`[OrderFlow] [${this.symbol}] ✅ Merge: archivo=${archivedFootprints.length}, backend: +${backendAdded} nuevos, ~${backendUpdated} actualizados, -${backendIgnored} ignorados = ${finalFootprints.length} total`);

        // 🔍 DIAGNÓSTICO: Verificar estructura después del merge
        if (finalFootprints.length > 0) {
          const first = finalFootprints[0];
          const last = finalFootprints[finalFootprints.length - 1];
          const mid = finalFootprints[Math.floor(finalFootprints.length / 2)];

          console.log(`[OrderFlow] [${this.symbol}] 🔍 POST-MERGE: first.levels=${!!first.levels}, mid.levels=${!!mid.levels}, last.levels=${!!last.levels}`);

          // Contar cuántos tienen levels vs price_levels
          let withLevels = 0;
          let withPriceLevels = 0;
          let withNeither = 0;

          for (const fp of finalFootprints) {
            if (fp.levels) withLevels++;
            else if (fp.price_levels) withPriceLevels++;
            else withNeither++;
          }

          console.log(`[OrderFlow] [${this.symbol}] 🔍 FORMATO: ${withLevels} con levels, ${withPriceLevels} con price_levels, ${withNeither} sin ninguno`);
        }

        // Log detallado de rangos después del merge
        if (finalFootprints.length > 0) {
          const firstFp = finalFootprints[0];
          const lastFp = finalFootprints[finalFootprints.length - 1];
          const firstDate = new Date(firstFp.candle_timestamp).toLocaleString('es-ES');
          const lastDate = new Date(lastFp.candle_timestamp).toLocaleString('es-ES');
          const rangeHours = ((lastFp.candle_timestamp - firstFp.candle_timestamp) / (1000 * 60 * 60)).toFixed(1);

          console.log(`[OrderFlow] [${this.symbol}] 🔍 MERGED ${this.interval}min RANGO FINAL:`);
          console.log(`[OrderFlow] [${this.symbol}]   • Desde: ${firstDate}`);
          console.log(`[OrderFlow] [${this.symbol}]   • Hasta: ${lastDate}`);
          console.log(`[OrderFlow] [${this.symbol}]   • Duración: ${rangeHours} horas (~${(rangeHours / 24).toFixed(1)} días)`);
          console.log(`[OrderFlow] [${this.symbol}]   • Footprints: ${finalFootprints.length} de ${this.interval}min`);
        }
      }

      this.footprints = finalFootprints;
      const newCount = this.footprints.length;

      // Solo loguear cuando hay cambios significativos o es la primera carga
      const isFirstLoad = oldCount === 0 && newCount > 0;
      const hasNewFootprints = newCount > oldCount;
      const significantChange = Math.abs(newCount - oldCount) > 10;

      if (isFirstLoad) {
        console.log(`[OrderFlow] [${this.symbol}] INITIAL LOAD: ${newCount} footprints`);
      } else if (hasNewFootprints) {
        console.log(`[OrderFlow] [${this.symbol}] +${newCount - oldCount} footprints (total: ${newCount})`);
      } else if (significantChange) {
        console.warn(`[OrderFlow] [${this.symbol}] footprints changed: ${oldCount} -> ${newCount}`);
      } else if (newCount === 0 && oldCount > 0) {
        console.warn(`[OrderFlow] [${this.symbol}] footprints LOST: ${oldCount} -> 0`);
      }
      // Si no hay cambios, no loguear nada

      return true;
    } catch (error) {
      console.error(`[OrderFlow] [${this.symbol}] fetchFootprints: exception - ${error.message}`);
      return false;
    } finally {
      this.isFetching = false;
    }
  }

  /**
   * Analiza y loguea los rangos de timestamps de footprints, identificando grupos contiguos y gaps
   */
  _logFootprintRanges() {
    if (!this.footprints || this.footprints.length === 0) return;

    const fps = this.footprints;
    const timestamps = fps.map(fp => fp.candle_timestamp).sort((a, b) => a - b);

    const firstTs = timestamps[0];
    const lastTs = timestamps[timestamps.length - 1];
    const firstDate = new Date(firstTs).toLocaleString();
    const lastDate = new Date(lastTs).toLocaleString();

    // Detectar el intervalo esperado (60000ms para 1m, 300000ms para 5m)
    const expectedIntervalMs = this.interval === "1" ? 60000 : 300000;
    const toleranceMs = expectedIntervalMs * 0.1; // 10% tolerance

    // Encontrar grupos contiguos y gaps
    const groups = [];
    let currentGroup = { start: timestamps[0], end: timestamps[0], count: 1 };

    for (let i = 1; i < timestamps.length; i++) {
      const gap = timestamps[i] - timestamps[i - 1];

      if (Math.abs(gap - expectedIntervalMs) <= toleranceMs) {
        // Contiguo - extender grupo actual
        currentGroup.end = timestamps[i];
        currentGroup.count++;
      } else {
        // Gap detectado - cerrar grupo actual y empezar uno nuevo
        groups.push({ ...currentGroup });
        currentGroup = { start: timestamps[i], end: timestamps[i], count: 1 };
      }
    }
    // Agregar el ultimo grupo
    groups.push(currentGroup);

    // Log resumen EN UNA SOLA LÍNEA para evitar que se pierda
    console.log(`[OrderFlow] [${this.symbol}] FOOTPRINT RANGES: Total=${fps.length}, Rango=${firstDate} → ${lastDate}, Grupos=${groups.length}`);

    // Log cada grupo
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const startDate = new Date(g.start).toLocaleString();
      const endDate = new Date(g.end).toLocaleString();
      const durationMinutes = Math.round((g.end - g.start) / 60000);
      console.log(`    Grupo ${i + 1}: ${startDate} -> ${endDate} (${g.count} fps, ${durationMinutes} min)`);

      // Si hay un grupo siguiente, mostrar el gap
      if (i < groups.length - 1) {
        const nextGroup = groups[i + 1];
        const gapMinutes = Math.round((nextGroup.start - g.end) / 60000);
        console.log(`    >>> GAP: ${gapMinutes} minutos <<<`);
      }
    }
  }

  /**
   * Check if Order Flow should replace Japanese candles
   * Returns true only when we can actually render the full Order Flow
   * @param {number} candleWidth - Current width of each candle in pixels
   */
  shouldReplaceCandles(candleWidth = 0) {
    // Only replace candles if:
    // 1. Indicator is enabled
    // 2. Config is enabled
    // 3. We have footprint data
    // 4. Candle width is sufficient for Order Flow rendering
    const hasData = this.enabled && this.config.enabled && this.footprints.length > 0;
    const widthSufficient = candleWidth >= this.config.minCandleWidth;
    return hasData && widthSufficient;
  }

  /**
   * FIX: Busca el footprint que corresponde a una vela con tolerancia de timestamp.
   * Los timestamps de velas (REST API) y footprints (WebSocket) pueden diferir ligeramente.
   *
   * @param {number} candleTimestamp - Timestamp de la vela en ms
   * @param {Map} footprintMap - Map de timestamp -> footprint
   * @param {number} toleranceMs - Tolerancia en ms (default: 30000 = 30 segundos)
   * @returns {Object|null} - Footprint encontrado o null
   */
  _findFootprintForCandle(candleTimestamp, footprintMap, toleranceMs = 30000) {
    // Primero intentar match exacto (mas eficiente)
    if (footprintMap.has(candleTimestamp)) {
      return footprintMap.get(candleTimestamp);
    }

    // Si no hay match exacto, buscar dentro de la tolerancia
    // Usar el footprint mas cercano en tiempo
    let bestMatch = null;
    let bestDiff = Infinity;

    for (const [fpTs, fp] of footprintMap) {
      const diff = Math.abs(fpTs - candleTimestamp);
      if (diff <= toleranceMs && diff < bestDiff) {
        bestDiff = diff;
        bestMatch = fp;
      }
    }

    return bestMatch;
  }

  /**
   * Main render method - draws the complete Order Flow unit for each candle
   */
  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    // Skip silently if disabled (normal behavior)
    if (!this.enabled || !this.config.enabled) return;

    // Log only when footprints become empty unexpectedly
    if (this.footprints.length === 0) {
      if (!this._loggedNoFootprints) {
        console.warn(`[OrderFlow] [${this.symbol}] renderOverlay: no footprints available`);
        this._loggedNoFootprints = true;
      }
      return;
    }
    this._loggedNoFootprints = false;

    if (visibleCandles.length === 0) return;

    const candleWidth = bounds.width / visibleCandles.length;

    // Diagnostic log - ejecutar una vez cuando cambia el número de footprints
    const fpCountChanged = !this._lastFpCount || this._lastFpCount !== this.footprints.length;
    if (fpCountChanged && this.footprints.length > 0) {
      this._lastFpCount = this.footprints.length;
      const mode = candleWidth < this.config.minCandleWidth ? 'DOTS (zoomed out)' : 'FOOTPRINT (zoomed in)';
      console.log(`[OrderFlow] [${this.symbol}] RENDER: ${this.footprints.length} fps, candleWidth=${candleWidth.toFixed(1)}px, mode=${mode}`);

      // Log rango de velas visibles para comparar con footprints
      if (visibleCandles.length > 0) {
        const firstCandle = new Date(visibleCandles[0].timestamp).toLocaleString();
        const lastCandle = new Date(visibleCandles[visibleCandles.length - 1].timestamp).toLocaleString();
        console.log(`[OrderFlow] [${this.symbol}] CANDLES VISIBLE: ${firstCandle} → ${lastCandle} (${visibleCandles.length} velas)`);

        // 🔍 CRÍTICO: Comparar con allCandles
        if (allCandles && allCandles.length > 0) {
          const firstAll = new Date(allCandles[0].timestamp).toLocaleString();
          const lastAll = new Date(allCandles[allCandles.length - 1].timestamp).toLocaleString();
          console.log(`[OrderFlow] [${this.symbol}] CANDLES ALL: ${firstAll} → ${lastAll} (${allCandles.length} velas TOTALES)`);
        }

        // Comparar con footprints
        if (this.footprints.length > 0) {
          const fpTimestamps = this.footprints.map(fp => fp.candle_timestamp).sort((a, b) => a - b);
          const firstFp = new Date(fpTimestamps[0]).toLocaleString();
          const lastFp = new Date(fpTimestamps[fpTimestamps.length - 1]).toLocaleString();
          console.log(`[OrderFlow] [${this.symbol}] FP RANGE: ${firstFp} → ${lastFp}`);
        }
      }
    }

    // Minimum width check - if too small for full footprint, render imbalance dots instead
    if (candleWidth < this.config.minCandleWidth) {
      this.renderImbalanceMarkers(ctx, bounds, visibleCandles, priceContext, candleWidth);
      return;
    }

    const fullMode = candleWidth >= this.config.minCandleWidthFull;

    // Price to Y conversion
    const priceToY = (price) => {
      if (!priceContext) return bounds.y;
      if (priceContext.priceToY) {
        return priceContext.priceToY(price);
      }
      const { minPrice, maxPrice } = priceContext;
      return bounds.y + ((maxPrice - price) / (maxPrice - minPrice)) * bounds.height;
    };

    // Create footprint map by timestamp
    const footprintMap = new Map();
    for (const fp of this.footprints) {
      footprintMap.set(fp.candle_timestamp, fp);
    }

    // 🔍 DIAGNÓSTICO: Log matching de timestamps (siempre en primera renderización)
    if (!this._loggedMatching && visibleCandles.length > 0 && this.footprints.length > 0) {
      this._loggedMatching = true;

      const firstCandleTs = visibleCandles[0].timestamp;
      const lastCandleTs = visibleCandles[visibleCandles.length - 1].timestamp;
      const firstFpTs = this.footprints[0].candle_timestamp;
      const lastFpTs = this.footprints[this.footprints.length - 1].candle_timestamp;

      console.log(`[OrderFlow] [${this.symbol}] 🔍 MATCHING: velas ${new Date(firstCandleTs).toLocaleString()} → ${new Date(lastCandleTs).toLocaleString()} (${visibleCandles.length} velas)`);
      console.log(`[OrderFlow] [${this.symbol}] 🔍 MATCHING: fps   ${new Date(firstFpTs).toLocaleString()} → ${new Date(lastFpTs).toLocaleString()} (${this.footprints.length} fps)`);

      // Verificar overlap
      const hasOverlap = !(lastFpTs < firstCandleTs || firstFpTs > lastCandleTs);
      console.log(`[OrderFlow] [${this.symbol}] 🔍 MATCHING: overlap=${hasOverlap}, tolerancia=±${this.config.timestampToleranceMs}ms`);

      // Probar matching de primeras 5 velas
      console.log(`[OrderFlow] [${this.symbol}] 🔍 MATCHING: Probando primeras 5 velas...`);
      for (let i = 0; i < Math.min(5, visibleCandles.length); i++) {
        const candle = visibleCandles[i];
        const fp = this._findFootprintForCandle(candle.timestamp, footprintMap, this.config.timestampToleranceMs);
        const candleDate = new Date(candle.timestamp).toLocaleString();
        if (fp) {
          const fpDate = new Date(fp.candle_timestamp).toLocaleString();
          const diff = Math.abs(candle.timestamp - fp.candle_timestamp);
          console.log(`[OrderFlow] [${this.symbol}]   ✅ Vela[${i}] ${candleDate} → FP ${fpDate} (diff: ${diff}ms)`);
        } else {
          console.log(`[OrderFlow] [${this.symbol}]   ❌ Vela[${i}] ${candleDate} → SIN MATCH`);
        }
      }
    }

    // DEBUG: Contar matches para verificar el fix
    let matchedCount = 0;
    let unmatchedCount = 0;
    let firstMatchedTs = null;
    let lastMatchedTs = null;
    let firstUnmatchedTs = null;
    let lastUnmatchedTs = null;

    // 🔍 NUEVO DEBUG: Verificar matching cuando cambia el rango de velas visibles
    const firstVisibleTs = visibleCandles.length > 0 ? visibleCandles[0].timestamp : 0;
    const rangeChanged = this._lastFirstVisibleTs !== firstVisibleTs;

    if (visibleCandles.length > 0 && rangeChanged && candleWidth >= this.config.minCandleWidth) {
      this._lastFirstVisibleTs = firstVisibleTs;

      console.log(`[OrderFlow] [${this.symbol}] 🔍 DETAILED MATCHING TEST (FOOTPRINT MODE):`);
      console.log(`[OrderFlow] [${this.symbol}]   Total velas visibles: ${visibleCandles.length}`);
      console.log(`[OrderFlow] [${this.symbol}]   Total footprints: ${this.footprints.length}`);

      const firstCandle = new Date(visibleCandles[0].timestamp).toLocaleString('es-ES');
      const lastCandle = new Date(visibleCandles[visibleCandles.length - 1].timestamp).toLocaleString('es-ES');
      console.log(`[OrderFlow] [${this.symbol}]   Rango velas: ${firstCandle} → ${lastCandle}`);

      // Probar primeras 5 y últimas 5 velas
      const testIndices = [0, 1, 2, 3, 4];
      const lastIdx = visibleCandles.length - 1;
      testIndices.push(lastIdx - 4, lastIdx - 3, lastIdx - 2, lastIdx - 1, lastIdx);

      for (const idx of testIndices) {
        if (idx < 0 || idx >= visibleCandles.length) continue;
        const candle = visibleCandles[idx];
        const fp = this._findFootprintForCandle(candle.timestamp, footprintMap, this.config.timestampToleranceMs);
        const candleDate = new Date(candle.timestamp).toLocaleString('es-ES');
        if (fp) {
          const fpDate = new Date(fp.candle_timestamp).toLocaleString('es-ES');
          const hasLevels = !!(fp.levels || fp.price_levels);
          const diff = Math.abs(candle.timestamp - fp.candle_timestamp);
          console.log(`[OrderFlow] [${this.symbol}]   [${idx}] ✅ ${candleDate} → FP ${fpDate}, hasLevels=${hasLevels}, diff=${diff}ms`);
        } else {
          console.log(`[OrderFlow] [${this.symbol}]   [${idx}] ❌ ${candleDate} (ts: ${candle.timestamp}) → NO MATCH`);

          // 🔍 DEBUG: Verificar primeros 3 footprints para ver sus timestamps
          if (idx === 0) {
            console.log(`[OrderFlow] [${this.symbol}]       🔍 PRIMEROS 3 FOOTPRINTS EN MEMORIA:`);
            for (let i = 0; i < Math.min(3, this.footprints.length); i++) {
              const fp = this.footprints[i];
              const fpDate = new Date(fp.candle_timestamp).toLocaleString('es-ES');
              console.log(`[OrderFlow] [${this.symbol}]         FP[${i}]: ${fpDate} (ts: ${fp.candle_timestamp})`);
            }
          }

          // Buscar footprints cercanos
          const nearbyFps = this.footprints.filter(fp =>
            Math.abs(fp.candle_timestamp - candle.timestamp) < 600000 // dentro de 10 minutos
          ).slice(0, 3);

          if (nearbyFps.length > 0) {
            console.log(`[OrderFlow] [${this.symbol}]       Footprints cercanos:`);
            for (const nfp of nearbyFps) {
              const nfpDate = new Date(nfp.candle_timestamp).toLocaleString('es-ES');
              const diff = (nfp.candle_timestamp - candle.timestamp) / 60000;
              console.log(`[OrderFlow] [${this.symbol}]         • ${nfpDate} (${diff > 0 ? '+' : ''}${diff.toFixed(1)} min)`);
            }
          } else if (idx < 3) {
            // Si NO hay footprints cercanos, buscar el más cercano en general
            console.log(`[OrderFlow] [${this.symbol}]       ⚠️ NO hay footprints dentro de 10 minutos`);
          }
        }
      }
    }

    ctx.save();

    // 🔍 DIAGNÓSTICO CRÍTICO: Contar cuántos footprints matchean
    let totalMatches = 0;
    let totalNoMatches = 0;
    let firstMatchIdx = -1;
    let lastMatchIdx = -1;

    // ✅ FIX CRÍTICO: Renderizar usando visibleCandles pero con posición relativa correcta
    // visibleCandles es un subset de allCandles que cabe en el viewport actual
    // Necesitamos calcular la posición X relativa al inicio de visibleCandles, no de allCandles

    // Render each visible candle
    for (let i = 0; i < visibleCandles.length; i++) {
      const candle = visibleCandles[i];

      // FIX: Usar matching tolerante en lugar de exacto
      const footprint = this._findFootprintForCandle(candle.timestamp, footprintMap, this.config.timestampToleranceMs);

      if (!footprint) {
        // No se encontró footprint para esta vela
        this.renderSimpleCandle(ctx, candle, bounds.x + i * candleWidth, candleWidth, priceToY);
        unmatchedCount++;
        totalNoMatches++;
        if (!firstUnmatchedTs) firstUnmatchedTs = candle.timestamp;
        lastUnmatchedTs = candle.timestamp;
        continue;
      }

      totalMatches++;
      if (firstMatchIdx === -1) firstMatchIdx = i;
      lastMatchIdx = i;

      // ✅ SOPORTE DUAL: levels (backend) o price_levels (archivo sin agregar)
      const levels = footprint.levels || footprint.price_levels;

      if (!levels) {
        // Footprint existe pero no tiene campo 'levels' ni 'price_levels'
        this.renderSimpleCandle(ctx, candle, bounds.x + i * candleWidth, candleWidth, priceToY);
        unmatchedCount++;

        // 🔍 DEBUG: Log first rejected footprint
        if (!this._loggedFirstNoLevels) {
          this._loggedFirstNoLevels = true;
          console.warn(`[OrderFlow] [${this.symbol}] ⚠️ ZOOM IN: Footprint sin levels - ${new Date(footprint.candle_timestamp).toLocaleString()}, keys=${Object.keys(footprint).join(',')}`);
        }

        if (!firstUnmatchedTs) firstUnmatchedTs = candle.timestamp;
        lastUnmatchedTs = candle.timestamp;
        continue;
      }

      if (levels.length === 0) {
        // Footprint tiene 'levels' pero está vacío
        this.renderSimpleCandle(ctx, candle, bounds.x + i * candleWidth, candleWidth, priceToY);
        unmatchedCount++;

        // 🔍 DEBUG: Log first empty levels
        if (!this._loggedFirstEmptyLevels) {
          this._loggedFirstEmptyLevels = true;
          console.warn(`[OrderFlow] [${this.symbol}] ⚠️ ZOOM IN: Footprint con levels vacío - ${new Date(footprint.candle_timestamp).toLocaleString()}`);
        }

        if (!firstUnmatchedTs) firstUnmatchedTs = candle.timestamp;
        lastUnmatchedTs = candle.timestamp;
        continue;
      }

      // Actualizar footprint para usar levels extraídos (no modificar objeto original)
      const normalizedFootprint = { ...footprint, levels };

      matchedCount++;
      if (!firstMatchedTs) firstMatchedTs = candle.timestamp;
      lastMatchedTs = candle.timestamp;

      // Posición X es relativa al viewport (visibleCandles), no a allCandles
      const unitX = bounds.x + i * candleWidth;
      this.renderOrderFlowUnit(ctx, candle, normalizedFootprint, unitX, candleWidth, priceToY, fullMode);
    }

    // ✅ LOG SIMPLE PERMANENTE - Se ejecuta SIEMPRE (una vez por segundo máximo)
    const now = Date.now();
    if (!this._lastRenderLog || (now - this._lastRenderLog) > 1000) {
      this._lastRenderLog = now;

      console.log(`[OrderFlow] [${this.symbol}] RENDER: ${totalMatches}/${visibleCandles.length} velas con FP, ${this.footprints.length} fps disponibles, candleWidth=${candleWidth.toFixed(1)}px, fullMode=${fullMode}`);

      // Si hay 0 matches, mostrar info de debug
      if (totalMatches === 0 && this.footprints.length > 0 && visibleCandles.length > 0) {
        const fp0 = this.footprints[0];
        const fpLast = this.footprints[this.footprints.length - 1];
        const c0 = visibleCandles[0];
        const cLast = visibleCandles[visibleCandles.length - 1];

        console.warn(`[OrderFlow] [${this.symbol}] ⚠️ CERO MATCHES!`);
        console.warn(`  FP[0]: ts=${fp0.candle_timestamp} (${new Date(fp0.candle_timestamp).toLocaleString()}), levels=${fp0.levels?.length || 'undefined'}`);
        console.warn(`  FP[last]: ts=${fpLast.candle_timestamp} (${new Date(fpLast.candle_timestamp).toLocaleString()}), levels=${fpLast.levels?.length || 'undefined'}`);
        console.warn(`  Vela[0]: ts=${c0.timestamp} (${new Date(c0.timestamp).toLocaleString()})`);
        console.warn(`  Vela[last]: ts=${cLast.timestamp} (${new Date(cLast.timestamp).toLocaleString()})`);
        console.warn(`  Diff FP[0] vs Vela[0]: ${Math.abs(fp0.candle_timestamp - c0.timestamp)}ms`);
        console.warn(`  Tolerancia: ${this.config.timestampToleranceMs || 'UNDEFINED'}ms`);
      }

      // Si hay matches parciales, mostrar dónde empiezan
      if (totalMatches > 0 && firstMatchIdx > 0) {
        const firstMatchCandle = visibleCandles[firstMatchIdx];
        console.warn(`[OrderFlow] [${this.symbol}] ⚠️ Primeros ${firstMatchIdx} velas SIN FP. Primer match en índice ${firstMatchIdx}: ${new Date(firstMatchCandle.timestamp).toLocaleString()}`);
      }
    }

    ctx.restore();
  }

  /**
   * Render a simple Japanese candle when no footprint data is available
   */
  renderSimpleCandle(ctx, candle, x, width, priceToY) {
    const margin = width * 0.1;
    const bodyWidth = width - margin * 2;
    const centerX = x + width / 2;

    const isUp = candle.close >= candle.open;
    const color = isUp ? this.colors.CANDLE_UP : this.colors.CANDLE_DOWN;

    const highY = priceToY(candle.high);
    const lowY = priceToY(candle.low);
    const openY = priceToY(candle.open);
    const closeY = priceToY(candle.close);

    const bodyTop = Math.min(openY, closeY);
    const bodyBottom = Math.max(openY, closeY);
    const bodyHeight = Math.max(1, bodyBottom - bodyTop);

    // Wick
    ctx.strokeStyle = this.colors.CANDLE_WICK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, highY);
    ctx.lineTo(centerX, lowY);
    ctx.stroke();

    // Body
    ctx.fillStyle = color;
    ctx.fillRect(x + margin, bodyTop, bodyWidth, bodyHeight);
  }

  /**
   * Render the complete Order Flow unit: Candle | Footprint | Volume Profile
   * Layout order (left to right): Japanese Candle, Footprint (bid|ask), Volume Profile
   */
  renderOrderFlowUnit(ctx, candle, footprint, unitX, unitWidth, priceToY, fullMode) {
    const levels = footprint.levels;
    const pocIndex = footprint.poc_index;

    // Calculate section widths based on layout proportions
    const gap = unitWidth * this.layout.gapPct / 3;

    // Candle section (leftmost)
    const candleWidth = unitWidth * this.layout.candlePct;
    const candleX = unitX + gap;

    // Footprint section (center) - bid|ask
    const footprintWidth = unitWidth * this.layout.footprintPct;
    const footprintX = candleX + candleWidth + gap;

    // Volume Profile section (rightmost)
    const profileWidth = unitWidth * this.layout.profilePct;
    const profileX = footprintX + footprintWidth + gap;

    // Find max volume for profile scaling AND extended price range from footprint levels
    let maxVolume = 0;
    let footprintHigh = candle.high;
    let footprintLow = candle.low;

    for (const level of levels) {
      if (level.total_volume > maxVolume) {
        maxVolume = level.total_volume;
      }
      // Extend range to include all footprint levels
      if (level.price_max > footprintHigh) {
        footprintHigh = level.price_max;
      }
      if (level.price_min < footprintLow) {
        footprintLow = level.price_min;
      }
    }

    // 1. Draw Japanese Candle (leftmost) - with extended wicks to match footprint range
    if (this.config.showCandle) {
      this.renderJapaneseCandle(ctx, candle, candleX, candleWidth, priceToY, footprintHigh, footprintLow);
    }

    // 2. Draw Footprint (Bid | Ask) - center
    if (this.config.showFootprint) {
      this.renderFootprint(ctx, footprint, footprintX, footprintWidth, priceToY, fullMode, candle, unitX);
    }

    // 3. Draw Volume Profile bars (rightmost)
    if (this.config.showProfile) {
      this.renderVolumeProfile(ctx, levels, pocIndex, profileX, profileWidth, priceToY, maxVolume, candle);
    }

    // 4. Draw Delta at bottom
    if (this.config.showDelta && fullMode) {
      this.renderDelta(ctx, footprint, unitX, unitWidth, levels, priceToY);
    }
  }

  /**
   * Render Japanese candle (thin traditional style)
   * @param {number} extendedHigh - Optional: extended high from footprint levels
   * @param {number} extendedLow - Optional: extended low from footprint levels
   */
  renderJapaneseCandle(ctx, candle, x, width, priceToY, extendedHigh = null, extendedLow = null) {
    const centerX = x + width / 2;
    const bodyWidth = Math.max(2, width * 0.6);

    const isUp = candle.close >= candle.open;
    const color = isUp ? this.colors.CANDLE_UP : this.colors.CANDLE_DOWN;

    // Use extended range if provided (from footprint levels), otherwise use candle high/low
    const wickHigh = extendedHigh !== null ? extendedHigh : candle.high;
    const wickLow = extendedLow !== null ? extendedLow : candle.low;

    const highY = priceToY(wickHigh);
    const lowY = priceToY(wickLow);
    const openY = priceToY(candle.open);
    const closeY = priceToY(candle.close);

    const bodyTop = Math.min(openY, closeY);
    const bodyBottom = Math.max(openY, closeY);
    const bodyHeight = Math.max(1, bodyBottom - bodyTop);

    // Upper wick (extended to match footprint range)
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, highY);
    ctx.lineTo(centerX, bodyTop);
    ctx.stroke();

    // Lower wick (extended to match footprint range)
    ctx.beginPath();
    ctx.moveTo(centerX, bodyBottom);
    ctx.lineTo(centerX, lowY);
    ctx.stroke();

    // Body
    ctx.fillStyle = color;
    ctx.fillRect(centerX - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);

    // Body border
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(centerX - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
  }

  /**
   * Render Volume Profile (horizontal bars showing volume per level)
   * Bars grow from left to right (standard volume profile orientation)
   */
  renderVolumeProfile(ctx, levels, pocIndex, x, width, priceToY, maxVolume, candle) {
    if (maxVolume === 0) return;

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];

      const levelTopY = priceToY(level.price_max);
      const levelBottomY = priceToY(level.price_min);
      const levelHeight = Math.abs(levelBottomY - levelTopY);

      if (levelHeight < 1) continue;

      const bgY = Math.min(levelTopY, levelBottomY);

      // Bar width proportional to volume
      const volumeRatio = level.total_volume / maxVolume;
      const barWidth = width * volumeRatio;

      // Color: POC is gold, others are blue
      const isPOC = i === pocIndex;
      ctx.fillStyle = isPOC ? this.colors.PROFILE_POC : this.colors.PROFILE_BAR;

      // Draw bar from left to right (grows toward price scale)
      ctx.fillRect(x, bgY, barWidth, Math.max(1, levelHeight - 1));

      // POC marker - horizontal line across the profile
      if (isPOC && this.config.showPOC) {
        ctx.strokeStyle = this.colors.POC_LINE;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, bgY + levelHeight / 2);
        ctx.lineTo(x + barWidth, bgY + levelHeight / 2);
        ctx.stroke();
      }
    }
  }

  /**
   * Render Footprint (Bid | Ask volumes per level)
   */
  renderFootprint(ctx, footprint, x, width, priceToY, fullMode, candle, unitX) {
    const levels = footprint.levels;
    const pocIndex = footprint.poc_index;
    const imbalances = footprint.imbalances || [];
    const imbalanceSet = new Set(imbalances.map(ib => ib.level_index));

    // Build stacked imbalance lookup: level_index -> direction
    // Apply volume z-score filter: skip stacked imbalances from low-volume candles
    const stackedImbalances = footprint.stacked_imbalances || [];
    const minZScore = this.config.stackedMinVolumeZScore || 0;
    const fpZScore = footprint.volume_zscore != null ? footprint.volume_zscore : 0;
    const passesVolumeFilter = minZScore <= 0 || fpZScore >= minZScore;

    const stackedSet = new Map(); // level_index -> direction
    if (passesVolumeFilter) {
      for (const si of stackedImbalances) {
        const siLevels = si.levels || [];
        for (const lvIdx of siLevels) {
          stackedSet.set(lvIdx, si.direction);
        }
      }
    }

    const halfWidth = width / 2;
    const levelGap = 1;

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];

      const levelTopY = priceToY(level.price_max);
      const levelBottomY = priceToY(level.price_min);
      const levelHeight = Math.abs(levelBottomY - levelTopY);

      if (levelHeight < 2) continue;

      const bgY = Math.min(levelTopY, levelBottomY);
      const priceMid = (level.price_min + level.price_max) / 2;
      const textY = priceToY(priceMid);

      // Determine dominant side
      const bidDominates = level.bid_volume > level.ask_volume;
      const askDominates = level.ask_volume > level.bid_volume;

      // Left side: BID
      const bidBg = bidDominates ? this.colors.BID_BG_STRONG : this.colors.BID_BG_WEAK;
      ctx.fillStyle = bidBg;
      ctx.fillRect(x, bgY, halfWidth - 0.5, levelHeight - levelGap);

      // Right side: ASK
      const askBg = askDominates ? this.colors.ASK_BG_STRONG : this.colors.ASK_BG_WEAK;
      ctx.fillStyle = askBg;
      ctx.fillRect(x + halfWidth + 0.5, bgY, halfWidth - 0.5, levelHeight - levelGap);

      // Level border
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, bgY, width, levelHeight - levelGap);

      // Center divider
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + halfWidth, bgY);
      ctx.lineTo(x + halfWidth, bgY + levelHeight - levelGap);
      ctx.stroke();

      // POC marker
      if (this.config.showPOC && i === pocIndex) {
        ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
        ctx.fillRect(x, textY - 1, width, 2);
      }

      // Stacked imbalance - colored cell extended to the left (past the candle)
      if (this.config.showImbalances && stackedSet.has(i)) {
        const stackDir = stackedSet.get(i);
        const rgb = stackDir === 'BUY'
          ? (this.config.stackedBuyColor || '38,166,154')
          : (this.config.stackedSellColor || '239,83,80');
        const opacity = this.config.stackedOpacity != null ? this.config.stackedOpacity : 0.7;
        const cellH = levelHeight - levelGap;

        // Color the cell background with user color
        ctx.fillStyle = `rgba(${rgb}, ${opacity * 0.4})`;
        ctx.fillRect(x, bgY, width, cellH);

        // Colored border
        ctx.strokeStyle = `rgba(${rgb}, 0.95)`;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, bgY, width, cellH);

        // Extend colored strip to the LEFT past the candle
        // unitX is the start of the entire order flow unit
        if (unitX != null) {
          const extendLeft = x - unitX; // distance from footprint to unit start
          if (extendLeft > 0) {
            ctx.fillStyle = `rgba(${rgb}, ${opacity * 0.6})`;
            ctx.fillRect(unitX, bgY, extendLeft, cellH);
            // Border on the extended strip
            ctx.strokeStyle = `rgba(${rgb}, ${opacity * 0.8})`;
            ctx.lineWidth = 1;
            ctx.strokeRect(unitX, bgY, extendLeft, cellH);
          }
        }
      }
      // Simple imbalance border (yellow) - only if NOT part of a stacked
      else if (this.config.showImbalances && imbalanceSet.has(i)) {
        ctx.strokeStyle = this.colors.IMBALANCE_BORDER;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, bgY, width, levelHeight - levelGap);
      }

      // Text labels (only if enough space)
      const minHeightForText = fullMode ? 10 : 6;
      if (fullMode && width >= 30 && levelHeight >= minHeightForText) {
        const fontSize = Math.min(this.config.fontSize, levelHeight - 2, 11);
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = this.colors.TEXT;

        // BID volume (left, right-aligned)
        if (level.bid_volume > 0) {
          ctx.textAlign = 'right';
          const bidText = this.formatVolume(level.bid_volume);
          this.drawTextWithShadow(ctx, bidText, x + halfWidth - 2, textY);
        }

        // ASK volume (right, left-aligned)
        if (level.ask_volume > 0) {
          ctx.textAlign = 'left';
          const askText = this.formatVolume(level.ask_volume);
          this.drawTextWithShadow(ctx, askText, x + halfWidth + 3, textY);
        }
      }
    }
  }

  /**
   * Render total delta at bottom of the unit
   */
  renderDelta(ctx, footprint, unitX, unitWidth, levels, priceToY) {
    const totalDelta = footprint.total_delta;
    if (Math.abs(totalDelta) < 0.001) return;

    // Position below the lowest level
    const lowestLevel = levels[0];
    const bottomY = priceToY(lowestLevel.price_min) + 14;

    ctx.font = `bold ${this.config.fontSize}px Arial`;
    ctx.fillStyle = totalDelta >= 0 ? this.colors.CANDLE_UP : this.colors.CANDLE_DOWN;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const deltaText = totalDelta >= 0 ? `+${this.formatVolume(totalDelta)}` : this.formatVolume(totalDelta);
    this.drawTextWithShadow(ctx, deltaText, unitX + unitWidth / 2, bottomY);
  }

  /**
   * Format volume for display
   */
  formatVolume(volume) {
    if (volume === undefined || volume === null) return '0';
    const absVol = Math.abs(volume);
    if (absVol >= 1000000) return (volume / 1000000).toFixed(1) + 'M';
    if (absVol >= 1000) return (volume / 1000).toFixed(1) + 'K';
    if (absVol >= 100) return Math.round(volume).toString();
    if (absVol >= 1) return volume.toFixed(1);
    return volume.toFixed(2);
  }

  /**
   * Draw text with shadow for better visibility
   */
  drawTextWithShadow(ctx, text, x, y) {
    ctx.save();
    ctx.strokeStyle = this.colors.TEXT_SHADOW;
    ctx.lineWidth = 2;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // No separate pane rendering needed
  render(ctx, bounds) {
    return;
  }

  hasFootprintData() {
    return this.footprints && this.footprints.length > 0;
  }

  /**
   * DEBUG: Analiza los ultimos N footprints para detectar inconsistencias en niveles
   * Llama desde consola: indicatorManager.indicators.find(i => i.name === "Order Flow").debugAnalyzeFootprints()
   */
  debugAnalyzeFootprints(limit = 500) {
    if (!this.footprints || this.footprints.length === 0) {
      console.log('[DEBUG FOOTPRINT] No hay footprints cargados');
      return;
    }

    const fps = this.footprints.slice(-limit);
    console.log(`\n[DEBUG FOOTPRINT] Analizando ultimos ${fps.length} footprints de ${this.symbol}...`);
    console.log('='.repeat(100));

    const analysis = [];

    for (const fp of fps) {
      const levels = fp.levels || [];
      const numLevels = levels.length;

      // Calcular rango de precio de la vela
      const candleHigh = fp.candle_high || 0;
      const candleLow = fp.candle_low || 0;
      const candleRange = candleHigh - candleLow;
      const candleRangePct = candleLow > 0 ? (candleRange / candleLow) * 100 : 0;

      // Calcular tamaño de cada nivel
      let levelSizes = [];
      for (const level of levels) {
        const levelSize = level.price_max - level.price_min;
        levelSizes.push(levelSize);
      }

      const avgLevelSize = levelSizes.length > 0 ? levelSizes.reduce((a, b) => a + b, 0) / levelSizes.length : 0;
      const minLevelSize = levelSizes.length > 0 ? Math.min(...levelSizes) : 0;
      const maxLevelSize = levelSizes.length > 0 ? Math.max(...levelSizes) : 0;

      // El step_size esperado
      const stepSize = fp.step_size || 'N/A';

      analysis.push({
        timestamp: fp.candle_timestamp,
        date: new Date(fp.candle_timestamp).toLocaleString(),
        numLevels,
        candleRange: candleRange.toFixed(2),
        candleRangePct: candleRangePct.toFixed(4),
        stepSize,
        avgLevelSize: avgLevelSize.toFixed(4),
        minLevelSize: minLevelSize.toFixed(4),
        maxLevelSize: maxLevelSize.toFixed(4),
        levelSizesConsistent: Math.abs(maxLevelSize - minLevelSize) < 0.01 ? 'OK' : 'INCONSISTENT'
      });
    }

    // Mostrar tabla
    console.table(analysis);

    // Detectar anomalias
    const anomalies = analysis.filter(a => a.levelSizesConsistent !== 'OK' || a.stepSize === 'N/A');
    if (anomalies.length > 0) {
      console.log(`\n[DEBUG FOOTPRINT] ANOMALIAS DETECTADAS: ${anomalies.length}`);
      console.table(anomalies);
    }

    // Agrupar por step_size para ver si hay variacion
    const stepSizeGroups = {};
    for (const a of analysis) {
      const key = String(a.stepSize);
      if (!stepSizeGroups[key]) {
        stepSizeGroups[key] = { count: 0, examples: [] };
      }
      stepSizeGroups[key].count++;
      if (stepSizeGroups[key].examples.length < 3) {
        stepSizeGroups[key].examples.push(a.date);
      }
    }
    console.log('\n[DEBUG FOOTPRINT] Distribucion de step_size:');
    console.table(stepSizeGroups);

    // Comparar primeras 50 vs ultimas 50
    if (analysis.length >= 100) {
      const first50 = analysis.slice(0, 50);
      const last50 = analysis.slice(-50);

      const avgLevelsFirst = first50.reduce((sum, a) => sum + a.numLevels, 0) / 50;
      const avgLevelsLast = last50.reduce((sum, a) => sum + a.numLevels, 0) / 50;

      const avgRangeFirst = first50.reduce((sum, a) => sum + parseFloat(a.candleRangePct), 0) / 50;
      const avgRangeLast = last50.reduce((sum, a) => sum + parseFloat(a.candleRangePct), 0) / 50;

      console.log('\n[DEBUG FOOTPRINT] Comparacion ANTIGUAS vs RECIENTES:');
      console.log(`  Primeras 50 velas: avgLevels=${avgLevelsFirst.toFixed(1)}, avgRangePct=${avgRangeFirst.toFixed(4)}%`);
      console.log(`  Ultimas 50 velas:  avgLevels=${avgLevelsLast.toFixed(1)}, avgRangePct=${avgRangeLast.toFixed(4)}%`);

      if (Math.abs(avgLevelsLast - avgLevelsFirst) > 2) {
        console.log(`  ⚠️ DIFERENCIA SIGNIFICATIVA en numero de niveles!`);
      }
    }

    console.log('\n[DEBUG FOOTPRINT] Analisis completado');
    return analysis;
  }

  /**
   * Renders horizontal lines for stacked imbalances when zoomed out (candleWidth < minCandleWidth).
   * Each individual level of a stacked imbalance gets a horizontal line at its price.
   * BUY imbalances = green line, SELL imbalances = red line.
   * Line width is configurable via stackedLineWidth.
   */
  renderImbalanceMarkers(ctx, bounds, visibleCandles, priceContext, candleWidth) {
    if (!priceContext || !priceContext.priceToY) return;
    if (!this.footprints || this.footprints.length === 0) return;

    ctx.save();

    // Build footprint map for fast lookup
    const fpMap = new Map();
    for (const fp of this.footprints) {
      fpMap.set(fp.candle_timestamp, fp);
    }

    // ✅ LOG SIMPLE - Contar matches en modo DOTS
    let dotsMatches = 0;
    let dotsNoMatches = 0;
    for (const candle of visibleCandles) {
      const fp = this._findFootprintForCandle(candle.timestamp, fpMap, this.config.timestampToleranceMs);
      if (fp) dotsMatches++;
      else dotsNoMatches++;
    }

    const now = Date.now();
    if (!this._lastDotsLog || (now - this._lastDotsLog) > 1000) {
      this._lastDotsLog = now;
      console.log(`[OrderFlow] [${this.symbol}] DOTS MODE: ${dotsMatches}/${visibleCandles.length} velas con FP, ${this.footprints.length} fps disponibles`);

      if (dotsMatches === 0 && this.footprints.length > 0) {
        const fp0 = this.footprints[0];
        const c0 = visibleCandles[0];
        console.warn(`[OrderFlow] [${this.symbol}] ⚠️ DOTS: CERO MATCHES!`);
        console.warn(`  FP[0]: ${new Date(fp0.candle_timestamp).toLocaleString()}`);
        console.warn(`  Vela[0]: ${new Date(c0.timestamp).toLocaleString()}`);
        console.warn(`  Diff: ${Math.abs(fp0.candle_timestamp - c0.timestamp)}ms, tolerancia=${this.config.timestampToleranceMs}ms`);
      }
    }

    const { x: boundsX } = bounds;
    const lineWidth = this.config.stackedLineWidth || 2;
    const extend = this.config.stackedLineExtend || 3;
    const buyRgb = this.config.stackedBuyColor || '38,166,154';
    const sellRgb = this.config.stackedSellColor || '239,83,80';
    const baseOpacity = this.config.stackedOpacity != null ? this.config.stackedOpacity : 0.7;
    const minZScore = this.config.stackedMinVolumeZScore || 0;

    // Line extends beyond candle: centered on candle, total width = candleWidth * extend
    const totalLineWidth = candleWidth * extend;
    const extraHalf = (totalLineWidth - candleWidth) / 2;

    for (let i = 0; i < visibleCandles.length; i++) {
      const candle = visibleCandles[i];
      const fp = this._findFootprintForCandle(candle.timestamp, fpMap, this.config.timestampToleranceMs);

      if (!fp) continue; // Si no hay footprint, skip

      const candleX = boundsX + (i * candleWidth);

      // ✅ SI TIENE stacked_imbalances (footprints del backend): dibujar líneas completas
      if (fp.stacked_imbalances && fp.stacked_imbalances.length > 0) {
        // Volume z-score filter: skip footprints from low-volume candles
        if (minZScore > 0) {
          const fpZScore = fp.volume_zscore != null ? fp.volume_zscore : 0;
          if (fpZScore < minZScore) continue;
        }

        const levels = fp.levels || fp.price_levels || [];

        // Line start/end with extension, clamped to chart bounds
        const lineStartX = Math.max(boundsX, candleX - extraHalf);
        const lineEndX = Math.min(boundsX + bounds.width, candleX + candleWidth + extraHalf);

        for (const si of fp.stacked_imbalances) {
          const siLevels = si.levels || [];
          if (siLevels.length === 0) continue;

          const rgb = si.direction === 'BUY' ? buyRgb : sellRgb;
          ctx.strokeStyle = `rgba(${rgb}, ${baseOpacity})`;
          ctx.lineWidth = lineWidth;

          // Draw a horizontal line at each level's price_mid
          for (const lvIdx of siLevels) {
            const level = levels[lvIdx];
            if (!level) continue;

            const priceMid = level.price_mid || level.price || ((level.price_min + level.price_max) / 2);
            const y = priceContext.priceToY(priceMid);

            ctx.beginPath();
            ctx.moveTo(lineStartX, y);
            ctx.lineTo(lineEndX, y);
            ctx.stroke();
          }
        }
      }
      // ✅ SI NO TIENE stacked_imbalances (footprints agregados): dibujar POC simple
      else {
        const poc = fp.poc;
        if (!poc) continue; // Si no hay POC, skip

        const delta = fp.total_delta || fp.delta || 0;
        const rgb = delta >= 0 ? buyRgb : sellRgb;

        ctx.strokeStyle = `rgba(${rgb}, ${baseOpacity})`;
        ctx.lineWidth = 2;

        const lineStartX = Math.max(boundsX, candleX - extraHalf);
        const lineEndX = Math.min(boundsX + bounds.width, candleX + candleWidth + extraHalf);
        const y = priceContext.priceToY(poc);

        ctx.beginPath();
        ctx.moveTo(lineStartX, y);
        ctx.lineTo(lineEndX, y);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

}

export default OrderFlowIndicator;
