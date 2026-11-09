// src/components/indicators/OrderFlowIndicator.js

import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';
import pollingCoordinator from '../../utils/PollingCoordinator.js';
import { getFootprintArchiver } from '../../services/FootprintArchiverElectron.js';

// ============================================================================
// Estado compartido entre instancias del indicador (por moneda)
// ============================================================================

// Auto-descarga del archivo local: una sola a la vez por moneda y un intento cada 15 min.
// Antes cada sondeo de 5 s lanzaba otra descarga de 48 h sin esperar la anterior.
const AUTO_DOWNLOAD_RETRY_MS = 15 * 60 * 1000;
const autoDownloadState = new Map(); // symbol -> { inFlight, lastAttempt }

// Archivo local ya leido por moneda: se vuelve a leer solo si cambia en disco.
// Antes se leia y parseaba entero (hasta 89 MB) en cada sondeo de 5 s.
const ARCHIVE_CACHE_MAX = 2;
const archiveCache = new Map(); // symbol -> { path, size, mtimeMs, footprints }

// Pedidos al backend: completo cada 60 s y, entre medio, solo los ultimos footprints
const BACKEND_FULL_REFRESH_MS = 60 * 1000;
const BACKEND_RECENT_LIMIT = 10;

// Step e imbalances configurados en el backend: se consultan como mucho cada 15 s
const BACKEND_SETTINGS_TTL_MS = 15 * 1000;
const DEFAULT_IMBALANCE_SETTINGS = { imbalanceThreshold: 3.0, stackedMinLevels: 3 };

// Seguridad: una vela agregada nunca tiene mas celdas que esto (sube el step en multiplos si hace falta)
const MAX_CELLS_PER_CANDLE = 600;
const GRID_EPS = 1e-7;

function decimalsOf(x) {
  const text = String(x);
  if (text.includes('e-')) {
    const [mantissa, exponent] = text.split('e-');
    return (mantissa.split('.')[1]?.length || 0) + parseInt(exponent, 10);
  }
  return text.split('.')[1]?.length || 0;
}

function roundTo(x, decimals) {
  return Number(x.toFixed(decimals));
}

// Step "redondo" (1, 2 o 5 por potencia de 10) para datos sin step conocido
function niceStep(x) {
  if (!(x > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

function groupByInterval(footprints, intervalMs) {
  const groups = new Map();
  for (const fp of footprints) {
    const ts = fp.candle_timestamp;
    if (typeof ts !== 'number') continue;
    const start = Math.floor(ts / intervalMs) * intervalMs;
    let group = groups.get(start);
    if (!group) {
      group = [];
      groups.set(start, group);
    }
    group.push(fp);
  }
  return groups;
}

// Une dos listas de footprints de 1 minuto. En los minutos repetidos manda "preferred".
function mergeByTimestamp(base, preferred) {
  if (!base || base.length === 0) return preferred ? [...preferred] : [];
  if (!preferred || preferred.length === 0) return [...base];
  const map = new Map();
  for (const fp of base) map.set(fp.candle_timestamp, fp);
  for (const fp of preferred) map.set(fp.candle_timestamp, fp);
  return Array.from(map.values()).sort((a, b) => a.candle_timestamp - b.candle_timestamp);
}

// Misma regla que el backend en 1m (orderflow_service._calculate_imbalances_from_levels):
// imbalance si max/min >= umbral en el mismo nivel; si un lado es 0 no cuenta;
// stacked = niveles consecutivos en la misma direccion.
function computeImbalances(levels, threshold, minConsecutive) {
  const imbalances = [];
  const byIndex = new Map();
  for (let i = 0; i < levels.length; i++) {
    const bid = levels[i].bid_volume || 0;
    const ask = levels[i].ask_volume || 0;
    if (bid + ask <= 0) continue;
    const minVol = Math.min(bid, ask);
    const maxVol = Math.max(bid, ask);
    if (minVol <= 0) continue;
    const ratio = maxVol / minVol;
    if (ratio >= threshold) {
      const imbalance = {
        level_index: i,
        type: ask > bid ? 'BUY' : 'SELL',
        ratio: Math.round(ratio * 100) / 100,
        price_min: levels[i].price_min,
        price_max: levels[i].price_max,
        price_mid: levels[i].price_mid
      };
      imbalances.push(imbalance);
      byIndex.set(i, imbalance);
    }
  }

  const stacked = [];
  let streak = [];
  let direction = null;
  const flush = () => {
    if (streak.length >= minConsecutive) {
      const first = levels[streak[0]];
      const last = levels[streak[streak.length - 1]];
      const low = Math.min(first.price_min, last.price_min);
      const high = Math.max(first.price_max, last.price_max);
      const ratios = streak.map(i => byIndex.get(i).ratio);
      stacked.push({
        type: 'STACKED_IMBALANCE',
        direction,
        levels: streak.slice(),
        levels_count: streak.length,
        start_price: low,
        end_price: high,
        mid_price: (low + high) / 2,
        avg_ratio: Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100) / 100
      });
    }
  };
  for (let i = 0; i < levels.length; i++) {
    const imbalance = byIndex.get(i);
    if (imbalance) {
      if (imbalance.type === direction) {
        streak.push(i);
      } else {
        flush();
        streak = [i];
        direction = imbalance.type;
      }
    } else {
      flush();
      streak = [];
      direction = null;
    }
  }
  flush();
  return { imbalances, stacked };
}

// Z-score del volumen contra las 20 velas anteriores, como el backend en 1m
function applyVolumeZScores(footprints, lookback = 20) {
  const buffer = [];
  let sum = 0;
  let sumSq = 0;
  for (const fp of footprints) {
    const volume = fp.total_volume || 0;
    if (buffer.length >= 2) {
      const n = buffer.length;
      const mean = sum / n;
      const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
      fp.volume_zscore = std > 0 ? Math.round(((volume - mean) / std) * 100) / 100 : 0;
    } else {
      fp.volume_zscore = 0;
    }
    buffer.push(volume);
    sum += volume;
    sumSq += volume * volume;
    if (buffer.length > lookback) {
      const old = buffer.shift();
      sum -= old;
      sumSq -= old * old;
    }
  }
}

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

    // Debug tracking
    this._loggedMismatch = false; // Flag para loguear desajustes candle/footprint solo una vez

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
      timestampToleranceMs: 30000, // Tolerancia para matching de timestamps vela-footprint (30 segundos)
      stepSizeOverride: null   // Override manual del step_size (null = auto)
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
    this._archiveAggCache = null;
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
   * Step objetivo para agregar: el del backend (modal), si no el override local,
   * si no la moda de los datos. null = cada vela usa el step de sus propios datos.
   */
  _resolveTargetStep(footprints1min, backendStepSize) {
    const valid = (s) => typeof s === 'number' && isFinite(s) && s > 0;
    if (valid(backendStepSize)) return { step: backendStepSize, source: 'backend' };
    const configStepSize = this.config.stepSizeOverride;
    if (valid(configStepSize)) return { step: configStepSize, source: 'config' };
    const counts = new Map();
    for (const fp of footprints1min) {
      if (valid(fp.step_size)) counts.set(fp.step_size, (counts.get(fp.step_size) || 0) + 1);
    }
    let mode = null;
    let best = 0;
    for (const [stepSize, count] of counts) {
      if (count > best) {
        best = count;
        mode = stepSize;
      }
    }
    if (mode != null) return { step: mode, source: 'mode' };
    return { step: null, source: 'datos' };
  }

  /**
   * Agrega footprints de 1 minuto de un mismo intervalo (ej: 5 minutos) en una sola vela.
   *
   * Reglas (8 nov 2026):
   * - Cada nivel de origen va entero a UNA celda: la que contiene su precio medio. Antes se sumaba
   *   completo en todas las celdas que tocaba: con step 5 sobre datos de step 10 cada celda
   *   mostraba el doble del volumen real.
   * - El step de la vela es el mayor entre el objetivo y el de sus datos: no se puede mostrar
   *   mas fino que lo que se grabo.
   * - Se aceptan steps chicos (monedas baratas). Antes todo lo menor a 0.01 se cambiaba a 0.1.
   * - Se recalculan POC, imbalances y stacked con la misma regla que usa el backend en 1m.
   */
  _aggregateGroup(groupFootprints, intervalStart, targetInterval, targetStep, settings) {
    if (!groupFootprints || groupFootprints.length === 0) return null;
    const fps = groupFootprints.length > 1
      ? [...groupFootprints].sort((a, b) => a.candle_timestamp - b.candle_timestamp)
      : groupFootprints;

    let high = -Infinity;
    let low = Infinity;
    let sourceStep = 0;
    let totalVolume = 0;
    let totalDelta = 0;
    const entries = [];

    for (const fp of fps) {
      const h = fp.candle_high ?? fp.high;
      const l = fp.candle_low ?? fp.low;
      if (typeof h === 'number' && isFinite(h) && h > high) high = h;
      if (typeof l === 'number' && isFinite(l) && l < low) low = l;
      if (typeof fp.step_size === 'number' && fp.step_size > sourceStep) sourceStep = fp.step_size;
      totalVolume += fp.total_volume || 0;
      totalDelta += fp.total_delta ?? fp.delta ?? 0;

      const levels = fp.levels || fp.price_levels || [];
      for (const level of levels) {
        const mid = level.price_mid ?? level.price ?? ((level.price_min + level.price_max) / 2);
        if (typeof mid !== 'number' || !isFinite(mid)) continue;
        const bid = level.bid_volume || 0;
        const ask = level.ask_volume || 0;
        entries.push({
          mid,
          bid,
          ask,
          total: level.total_volume ?? (bid + ask),
          delta: level.delta ?? (ask - bid),
          trades: level.trade_count || 0
        });
      }
    }

    // Rango a cubrir: extremos de la vela y precios medios de los niveles
    let rangeLow = low;
    let rangeHigh = high;
    for (const entry of entries) {
      if (entry.mid < rangeLow) rangeLow = entry.mid;
      if (entry.mid > rangeHigh) rangeHigh = entry.mid;
    }
    if (!isFinite(rangeLow) || !isFinite(rangeHigh)) return null;

    let step = Math.max(targetStep || 0, sourceStep || 0);
    if (!(step > 0)) step = rangeHigh > rangeLow ? niceStep((rangeHigh - rangeLow) / 20) : 1;

    let idxLow = Math.floor(rangeLow / step + GRID_EPS);
    let idxHigh = Math.floor(rangeHigh / step + GRID_EPS);
    const cellCount = idxHigh - idxLow + 1;
    if (cellCount > MAX_CELLS_PER_CANDLE) {
      step = step * Math.ceil(cellCount / MAX_CELLS_PER_CANDLE);
      idxLow = Math.floor(rangeLow / step + GRID_EPS);
      idxHigh = Math.floor(rangeHigh / step + GRID_EPS);
    }

    // Celdas por indice entero (sin claves de punto flotante), de mayor a menor precio
    const decimals = Math.min(12, decimalsOf(step) + 2);
    const cells = new Map();
    for (let i = idxHigh; i >= idxLow; i--) {
      const priceMin = roundTo(i * step, decimals);
      const priceMax = roundTo((i + 1) * step, decimals);
      const priceMid = roundTo((i + 0.5) * step, decimals);
      cells.set(i, {
        price: priceMid,
        price_min: priceMin,
        price_max: priceMax,
        price_mid: priceMid,
        bid_volume: 0,
        ask_volume: 0,
        total_volume: 0,
        delta: 0,
        trade_count: 0
      });
    }
    for (const entry of entries) {
      const cell = cells.get(Math.floor(entry.mid / step + GRID_EPS));
      if (!cell) continue;
      cell.bid_volume += entry.bid;
      cell.ask_volume += entry.ask;
      cell.total_volume += entry.total;
      cell.delta += entry.delta;
      cell.trade_count += entry.trades;
    }

    const levels = Array.from(cells.values());
    let pocIndex = -1;
    let maxVolume = 0;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].total_volume > maxVolume) {
        maxVolume = levels[i].total_volume;
        pocIndex = i;
      }
    }
    const poc = pocIndex >= 0 ? levels[pocIndex].price : null;
    const thresholds = settings || DEFAULT_IMBALANCE_SETTINGS;
    const { imbalances, stacked } = computeImbalances(
      levels, thresholds.imbalanceThreshold, thresholds.stackedMinLevels
    );

    const first = fps[0];
    const last = fps[fps.length - 1];
    return {
      candle_timestamp: intervalStart,
      symbol: this.symbol,
      interval: targetInterval,
      candle_open: first.candle_open ?? first.open,
      candle_high: Math.max(isFinite(high) ? high : -Infinity, levels[0].price_max),
      candle_low: Math.min(isFinite(low) ? low : Infinity, levels[levels.length - 1].price_min),
      candle_close: last.candle_close ?? last.close,
      step_size: step,
      levels,
      num_levels: levels.length,
      total_volume: totalVolume,
      total_delta: totalDelta,
      delta: totalDelta,
      poc,
      poc_price: poc,
      poc_index: pocIndex,
      imbalances,
      stacked_imbalances: stacked,
      source_minutes: fps.length
    };
  }

  /**
   * Agrega footprints de 1 minuto a intervalos mayores (5min, 15min, 1h, etc.)
   *
   * Maneja los dos formatos (archivo de la nube y backend): candle_open/high/low/close o
   * open/high/low/close, y levels[] o price_levels[].
   *
   * @param {Array} footprints1min - Footprints de 1 minuto
   * @param {string} targetInterval - Intervalo objetivo ("5", "15", "60", etc.)
   * @param {number} backendStepSize - Step size configurado en el backend (opcional, prioridad 1)
   * @param {Object} settings - { imbalanceThreshold, stackedMinLevels } (opcional)
   * @returns {Array} - Footprints agregados, ordenados por tiempo
   */
  async _aggregateFootprints(footprints1min, targetInterval, backendStepSize = null, settings = null) {
    if (targetInterval === "1") {
      return footprints1min; // No agregar si ya es 1min
    }

    const intervalMinutes = parseInt(targetInterval);
    if (isNaN(intervalMinutes)) {
      console.error(`[OrderFlow] [${this.symbol}] _aggregateFootprints: intervalo inválido ${targetInterval}`);
      return [];
    }

    const { step: targetStep, source } = this._resolveTargetStep(footprints1min, backendStepSize);
    if (!this._loggedStepSize) {
      this._loggedStepSize = true;
      console.log(`[OrderFlow] [${this.symbol}] STEP_SIZE objetivo: ${targetStep ?? 'el de los datos'} (fuente: ${source})`);
    }

    const groups = groupByInterval(footprints1min, intervalMinutes * 60 * 1000);
    const aggregated = [];
    for (const [intervalStart, groupFootprints] of groups) {
      const footprint = this._aggregateGroup(groupFootprints, intervalStart, targetInterval, targetStep, settings);
      if (footprint) aggregated.push(footprint);
    }
    aggregated.sort((a, b) => a.candle_timestamp - b.candle_timestamp);
    applyVolumeZScores(aggregated);
    return aggregated;
  }

  /**
   * Agrega archivo + backend reutilizando las velas que solo dependen del archivo:
   * esas se agregan una vez por version del archivo y las que tocan minutos del backend se rehacen
   * en cada sondeo con la union por minuto (el backend manda en los minutos que tiene).
   */
  _aggregateWithCache(archived1m, backend1m, settings) {
    const intervalMinutes = parseInt(this.interval);
    const intervalMs = intervalMinutes * 60 * 1000;
    const reference = archived1m.length > 0 ? archived1m : backend1m;
    const { step: targetStep, source } = this._resolveTargetStep(reference, settings.stepSize);

    const cacheKey = [this._archiveVersion || 'none', this.interval, targetStep,
      settings.imbalanceThreshold, settings.stackedMinLevels].join('|');
    if (!this._archiveAggCache || this._archiveAggCache.key !== cacheKey) {
      const minutes = groupByInterval(archived1m, intervalMs);
      const groups = new Map();
      for (const [intervalStart, groupFootprints] of minutes) {
        const footprint = this._aggregateGroup(groupFootprints, intervalStart, this.interval, targetStep, settings);
        if (footprint) groups.set(intervalStart, footprint);
      }
      this._archiveAggCache = { key: cacheKey, minutes, groups };
      if (!this._loggedStepSize || this._lastStepLogKey !== cacheKey) {
        this._loggedStepSize = true;
        this._lastStepLogKey = cacheKey;
        console.log(`[OrderFlow] [${this.symbol}] Agregación ${this.interval}m: step objetivo ${targetStep ?? 'el de los datos'} (fuente: ${source}), ${groups.size} velas del archivo`);
      }
    }

    const result = new Map(this._archiveAggCache.groups);
    const backendGroups = groupByInterval(backend1m, intervalMs);
    for (const [intervalStart, backendMinutes] of backendGroups) {
      const archiveMinutes = this._archiveAggCache.minutes.get(intervalStart) || [];
      const merged = mergeByTimestamp(archiveMinutes, backendMinutes);
      const footprint = this._aggregateGroup(merged, intervalStart, this.interval, targetStep, settings);
      if (footprint) result.set(intervalStart, footprint);
    }

    const aggregated = Array.from(result.values()).sort((a, b) => a.candle_timestamp - b.candle_timestamp);
    applyVolumeZScores(aggregated);
    return aggregated;
  }

  /**
   * Step e imbalances configurados en el backend (modal de Order Flow), con cache de 15 s.
   * Si el backend no responde se conservan los ultimos valores conocidos.
   */
  async _getBackendSettings(force = false) {
    const now = Date.now();
    if (!force && this._backendSettings && now - (this._backendSettingsAt || 0) < BACKEND_SETTINGS_TTL_MS) {
      return this._backendSettings;
    }
    const settings = {
      stepSize: this._backendSettings?.stepSize ?? null,
      imbalanceThreshold: this._backendSettings?.imbalanceThreshold ?? DEFAULT_IMBALANCE_SETTINGS.imbalanceThreshold,
      stackedMinLevels: this._backendSettings?.stackedMinLevels ?? DEFAULT_IMBALANCE_SETTINGS.stackedMinLevels
    };
    try {
      const [stepResponse, configResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/api/orderflow/step-size/${this.symbol}`),
        fetch(`${API_BASE_URL}/api/orderflow/config`)
      ]);
      if (stepResponse.ok) {
        const data = await stepResponse.json();
        if (data.success && data.step_size > 0) settings.stepSize = data.step_size;
      }
      if (configResponse.ok) {
        const data = await configResponse.json();
        if (data.imbalance_threshold > 0) settings.imbalanceThreshold = data.imbalance_threshold;
        if (data.stacked_min_levels > 0) settings.stackedMinLevels = data.stacked_min_levels;
      }
    } catch (error) {
      console.warn(`[OrderFlow] [${this.symbol}] ⚠️ No se pudo consultar la config del backend: ${error.message}`);
    }
    this._backendSettings = settings;
    this._backendSettingsAt = now;
    return settings;
  }

  /** Olvida la config cacheada del backend (al guardar un step nuevo en el modal). */
  invalidateBackendSettings() {
    this._backendSettings = null;
    this._backendSettingsAt = 0;
    this._archiveAggCache = null;
  }

  /**
   * Obtener step_size configurado en el backend para un símbolo
   * @returns {Promise<number|null>} - Step size o null si falla
   */
  async _fetchBackendStepSize() {
    const settings = await this._getBackendSettings();
    return settings.stepSize;
  }

  /**
   * Footprints de 1 minuto del archivo local (solo Electron).
   * Se vuelve a leer del disco solo si el archivo cambio (tamaño o fecha); la agregación se hace
   * después de unirlo con el backend.
   */
  async _loadFromArchive() {
    try {
      const api = window.electron;
      if (!api || !api.getUserDataPath || !api.readFile || !api.fileExists) {
        this._archiveVersion = 'none';
        return [];
      }

      const userDataPath = await api.getUserDataPath();
      const archivePath = `${userDataPath}/footprint_archive/${this.symbol}_1.json`;

      let info = null;
      if (api.getFileInfo) {
        info = await api.getFileInfo(archivePath);
        if (!info || !info.exists) {
          this._archiveVersion = 'none';
          return [];
        }
      } else if (!(await api.fileExists(archivePath))) {
        this._archiveVersion = 'none';
        return [];
      }

      const cached = archiveCache.get(this.symbol);
      let footprints1min;
      if (info && cached && cached.path === archivePath && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
        footprints1min = cached.footprints;
      } else {
        const content = await api.readFile(archivePath);
        const data = JSON.parse(content);
        footprints1min = Array.isArray(data.footprints) ? data.footprints : [];
        for (let i = 1; i < footprints1min.length; i++) {
          if (footprints1min[i].candle_timestamp < footprints1min[i - 1].candle_timestamp) {
            footprints1min.sort((a, b) => a.candle_timestamp - b.candle_timestamp);
            break;
          }
        }
        if (info) {
          archiveCache.delete(this.symbol);
          archiveCache.set(this.symbol, { path: archivePath, size: info.size, mtimeMs: info.mtimeMs, footprints: footprints1min });
          while (archiveCache.size > ARCHIVE_CACHE_MAX) {
            archiveCache.delete(archiveCache.keys().next().value);
          }
        }
        console.log(`[OrderFlow] [${this.symbol}] Archivo: ${footprints1min.length} fps de 1min`);
      }

      const lastTs = footprints1min.length > 0 ? footprints1min[footprints1min.length - 1].candle_timestamp : 0;
      this._archiveVersion = info ? `${info.size}:${info.mtimeMs}` : `${footprints1min.length}:${lastTs}`;

      // Archivo con más de 12 h de antigüedad: pedir a la nube lo que falta (con candado y espera)
      if (footprints1min.length > 0) {
        const ageHours = (Date.now() - lastTs) / (1000 * 60 * 60);
        if (ageHours > 12) {
          this._maybeAutoDownload(ageHours);
        }
      }

      return footprints1min;

    } catch (error) {
      console.error(`[OrderFlow] [${this.symbol}] _loadFromArchive ERROR: ${error.message}`);
      return [];
    }
  }

  /**
   * Lanza la auto-descarga solo si no hay otra en curso para la moneda y pasaron 15 min
   * desde el último intento. Descarga las horas que faltan (mínimo 48, máximo 168).
   */
  _maybeAutoDownload(ageHours) {
    const state = autoDownloadState.get(this.symbol) || { inFlight: false, lastAttempt: 0 };
    if (state.inFlight || Date.now() - state.lastAttempt < AUTO_DOWNLOAD_RETRY_MS) return;
    state.inFlight = true;
    state.lastAttempt = Date.now();
    autoDownloadState.set(this.symbol, state);

    const hours = Math.min(168, Math.max(48, Math.ceil(ageHours) + 2));
    console.log(`[OrderFlow] [${this.symbol}] Archivo desactualizado (${ageHours.toFixed(0)}h): descargando ${hours}h de la nube...`);
    this._autoDownloadArchive(hours).finally(() => {
      state.inFlight = false;
    });
  }

  /**
   * Descarga automática de footprints actualizados cuando el archivo está desactualizado.
   * No vuelve a leer el archivo: el siguiente sondeo lo hace si cambió en disco.
   * @returns {Promise<void>}
   */
  async _autoDownloadArchive(hours = 48) {
    try {
      const archiver = getFootprintArchiver();
      if (!archiver) return;

      const result = await archiver.archiveSymbol(this.symbol, hours);

      if (result.success) {
        console.log(`[OrderFlow] [${this.symbol}] Auto-descarga: +${result.added || 0} fps`);
      } else {
        console.warn(`[OrderFlow] [${this.symbol}] Auto-descarga sin cambios: ${result.error || 'sin datos'} (nuevo intento en 15 min)`);
      }
    } catch (error) {
      console.error(`[OrderFlow] [${this.symbol}] Auto-descarga falló: ${error.message}`);
    }
  }

  /**
   * Footprints de 1 minuto del backend. Pide la ventana completa cada 60 s y, entre medio,
   * solo los últimos minutos, que se unen a lo ya recibido.
   * @returns {Promise<{footprints: Array, failed: boolean}>}
   */
  async _fetchBackendFootprints() {
    const hours = this.config.historyHours || 12;
    const now = Date.now();
    const cache = this._backendCache;
    const needFull = !cache || cache.hours !== hours || now - cache.fetchedAt > BACKEND_FULL_REFRESH_MS;
    const url = needFull
      ? `${API_BASE_URL}/api/orderflow/footprint/${this.symbol}?interval=1&limit=2000&hours=${hours}`
      : `${API_BASE_URL}/api/orderflow/footprint/${this.symbol}?interval=1&limit=${BACKEND_RECENT_LIMIT}`;

    // Timeout de 120 segundos para el fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      this._retryCount = 0; // Reset retry count on success

      if (!response.ok) {
        console.error(`[OrderFlow] [${this.symbol}] Backend HTTP error ${response.status}`);
        return { footprints: cache ? cache.footprints : [], failed: true };
      }
      const data = await response.json();
      if (!data.success || !Array.isArray(data.footprints)) {
        console.warn(`[OrderFlow] [${this.symbol}] Backend retornó success=false`);
        return { footprints: cache ? cache.footprints : [], failed: true };
      }

      let footprints;
      if (needFull) {
        footprints = [...data.footprints].sort((a, b) => a.candle_timestamp - b.candle_timestamp);
        this._backendCache = { hours, fetchedAt: now, footprints };
      } else {
        const cutoff = now - hours * 3600 * 1000;
        footprints = mergeByTimestamp(cache.footprints, data.footprints)
          .filter(fp => fp.candle_timestamp >= cutoff);
        cache.footprints = footprints;
      }
      return { footprints, failed: false };

    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.warn(`[OrderFlow] [${this.symbol}] Backend error: ${fetchError.message}`);
      return { footprints: cache ? cache.footprints : [], failed: true };
    }
  }

  async fetchFootprints() {
    if (this._destroyed) return false;
    if (this.isFetching) return false;

    this.isFetching = true;
    this.lastFetchTime = Date.now();

    try {
      const supportedIntervals = ["1", "5"];

      if (!supportedIntervals.includes(this.interval)) {
        if (!this._loggedUnsupportedInterval) {
          this._loggedUnsupportedInterval = true;
          console.log(`[OrderFlow] [${this.symbol}] fetchFootprints: interval ${this.interval} not supported (only 1, 5)`);
        }
        this.footprints = [];
        return false;
      }

      // PASO 1: archivo local de 1 minuto (se relee solo si cambió en disco)
      let archived1m = [];
      try {
        archived1m = await this._loadFromArchive();
      } catch (archiveError) {
        // Silenciar - no es crítico
      }

      // PASO 2: backend, siempre en 1 minuto
      const { footprints: backend1m, failed: backendFailed } = await this._fetchBackendFootprints();

      if (this._destroyed) return false;

      const oldCount = this.footprints.length;

      if (archived1m.length === 0 && backend1m.length === 0) {
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
      }

      // PASO 3: unir en 1 minuto y agregar. El backend manda en los minutos que tiene.
      // Antes se agregaba cada fuente por separado y la vela de 5 min del borde entre
      // archivo y backend podía quedar con solo una parte de sus minutos.
      let finalFootprints;
      if (this.interval === "1") {
        finalFootprints = mergeByTimestamp(archived1m, backend1m);
      } else {
        const settings = await this._getBackendSettings();
        if (this._destroyed) return false;
        finalFootprints = this._aggregateWithCache(archived1m, backend1m, settings);
      }

      this.footprints = finalFootprints;
      const newCount = this.footprints.length;

      // Solo loguear cuando hay cambios significativos o es la primera carga
      const isFirstLoad = oldCount === 0 && newCount > 0;
      const hasNewFootprints = newCount > oldCount;
      const significantChange = Math.abs(newCount - oldCount) > 10;

      if (isFirstLoad) {
        console.log(`[OrderFlow] [${this.symbol}] INITIAL LOAD: ${newCount} footprints (archivo ${archived1m.length}, backend ${backend1m.length} de 1min)`);
      } else if (hasNewFootprints) {
        console.log(`[OrderFlow] [${this.symbol}] +${newCount - oldCount} footprints (total: ${newCount})`);
      } else if (significantChange) {
        console.warn(`[OrderFlow] [${this.symbol}] footprints changed: ${oldCount} -> ${newCount}`);
      } else if (newCount === 0 && oldCount > 0) {
        console.warn(`[OrderFlow] [${this.symbol}] footprints LOST: ${oldCount} -> 0`);
      }

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

    // Si no hay match exacto, el más cercano dentro de la tolerancia.
    // Búsqueda binaria sobre los timestamps ordenados: antes se recorrían todos los footprints
    // por cada vela sin footprint, en cada cuadro.
    const timestamps = footprintMap.sortedTimestamps;
    if (!timestamps || timestamps.length === 0) return null;
    let lo = 0;
    let hi = timestamps.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (timestamps[mid] < candleTimestamp) lo = mid + 1;
      else hi = mid;
    }
    let bestMatch = null;
    let bestDiff = Infinity;
    for (const i of [lo - 1, lo]) {
      if (i < 0 || i >= timestamps.length) continue;
      const diff = Math.abs(timestamps[i] - candleTimestamp);
      if (diff <= toleranceMs && diff < bestDiff) {
        bestDiff = diff;
        bestMatch = footprintMap.get(timestamps[i]);
      }
    }
    return bestMatch;
  }

  /**
   * Mapa timestamp -> footprint, reconstruido solo cuando cambia la lista de footprints
   * (antes se rehacía en cada cuadro). Lleva los timestamps ordenados para buscar con tolerancia.
   */
  _getFootprintMap() {
    if (this._footprintMapSource !== this.footprints || !this._footprintMap) {
      const map = new Map();
      for (const fp of this.footprints) {
        map.set(fp.candle_timestamp, fp);
      }
      map.sortedTimestamps = Array.from(map.keys()).sort((a, b) => a - b);
      this._footprintMap = map;
      this._footprintMapSource = this.footprints;
    }
    return this._footprintMap;
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

    // Log solo cuando cambia el conteo de footprints
    if (!this._lastFpCount || this._lastFpCount !== this.footprints.length) {
      this._lastFpCount = this.footprints.length;
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

    // Footprint map by timestamp (cached while the footprint list does not change)
    const footprintMap = this._getFootprintMap();

    ctx.save();

    // Render each visible candle
    for (let i = 0; i < visibleCandles.length; i++) {
      const candle = visibleCandles[i];
      const footprint = this._findFootprintForCandle(candle.timestamp, footprintMap, this.config.timestampToleranceMs);

      if (!footprint) {
        this.renderSimpleCandle(ctx, candle, bounds.x + i * candleWidth, candleWidth, priceToY);
        continue;
      }

      const levels = footprint.levels || footprint.price_levels;

      if (!levels || levels.length === 0) {
        this.renderSimpleCandle(ctx, candle, bounds.x + i * candleWidth, candleWidth, priceToY);
        continue;
      }

      const normalizedFootprint = { ...footprint, levels };
      const unitX = bounds.x + i * candleWidth;
      this.renderOrderFlowUnit(ctx, candle, normalizedFootprint, unitX, candleWidth, priceToY, fullMode);
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

    // ✅ Obtener levels del footprint (ya vienen del backend o de la agregación)
    let levels = footprint.levels || footprint.price_levels || [];
    // poc_index puede ser 0 (con "|| -1" se perdía y el perfil no marcaba el POC en la mitad de las velas de 1m)
    let pocIndex = footprint.poc_index ?? -1;
    const step_size = footprint.step_size || 1.0;

    // Si no hay levels, renderizar vela simple
    if (levels.length === 0) {
      this.renderSimpleCandle(ctx, candle, candleX, candleWidth, priceToY);
      return;
    }

    // ✅ FASE 2: Expansión dinámica para cubrir vela completa
    // Si los levels no cubren el rango completo de la vela, agregar levels vacíos
    let footprintHigh = -Infinity;
    let footprintLow = Infinity;

    for (const level of levels) {
      if (level.price_max > footprintHigh) footprintHigh = level.price_max;
      if (level.price_min < footprintLow) footprintLow = level.price_min;
    }

    const needsExpansionAbove = candle.high > footprintHigh;
    const needsExpansionBelow = candle.low < footprintLow;

    if (needsExpansionAbove || needsExpansionBelow) {
      const expandedLevels = [...levels];

      // Agregar levels vacíos arriba
      if (needsExpansionAbove) {
        let currentPriceMin = footprintHigh;
        while (currentPriceMin < candle.high) {
          const currentPriceMax = Math.min(currentPriceMin + step_size, candle.high + step_size);
          expandedLevels.push({
            price: (currentPriceMin + currentPriceMax) / 2,
            price_min: currentPriceMin,
            price_max: currentPriceMax,
            bid_volume: 0,
            ask_volume: 0,
            total_volume: 0,
            delta: 0
          });
          currentPriceMin = parseFloat((currentPriceMin + step_size).toFixed(8));
        }
      }

      // Agregar levels vacíos abajo
      if (needsExpansionBelow) {
        let currentPriceMax = footprintLow;
        while (currentPriceMax > candle.low) {
          const currentPriceMin = Math.max(currentPriceMax - step_size, candle.low - step_size);
          expandedLevels.push({
            price: (currentPriceMin + currentPriceMax) / 2,
            price_min: currentPriceMin,
            price_max: currentPriceMax,
            bid_volume: 0,
            ask_volume: 0,
            total_volume: 0,
            delta: 0
          });
          currentPriceMax = parseFloat((currentPriceMax - step_size).toFixed(8));
        }
      }

      // Ordenar levels (descendente por precio). Los niveles del backend no traen "price":
      // se ordena por price_min, y el POC se vuelve a ubicar por objeto, no por posición.
      const pocLevel = pocIndex >= 0 && pocIndex < levels.length ? levels[pocIndex] : null;
      expandedLevels.sort((a, b) => (b.price_min ?? b.price) - (a.price_min ?? a.price));
      pocIndex = pocLevel ? expandedLevels.indexOf(pocLevel) : -1;

      // Reemplazar levels con la versión expandida
      levels = expandedLevels;

      // Actualizar rango
      footprintHigh = candle.high;
      footprintLow = candle.low;
    }

    // Calcular maxVolume para renderizado
    let maxVolume = 0;
    for (const level of levels) {
      if (level.total_volume > maxVolume) {
        maxVolume = level.total_volume;
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

      // ✅ Reducir threshold para consistencia con footprint
      if (levelHeight < 0.5) continue;

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

    // ✅ NORMALIZACIÓN DE ALTURAS CORREGIDA: Calcular altura GLOBAL basada en step_size
    // El problema anterior era calcular altura basada en cada vela individual
    // Solución: Calcular altura de UNA celda de step_size en píxeles usando priceToY
    const step_size = footprint.step_size || 1.0;

    // Calcular cuántos píxeles ocupa UN step_size en la escala actual
    // Usamos un precio de referencia (high de la vela) para medir
    const refPrice = candle.high;
    const priceTop = refPrice;
    const priceBottom = refPrice - step_size;
    const yTop = priceToY(priceTop);
    const yBottom = priceToY(priceBottom);
    const cellHeightForStepSize = Math.abs(yBottom - yTop);

    // Usar esta altura para TODAS las celdas, con mínimo de 1.5px
    const normalizedCellHeight = Math.max(cellHeightForStepSize, 1.5);

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];

      // ✅ Usar altura normalizada en lugar de calcular individualmente
      const levelHeight = normalizedCellHeight;

      // ✅ Calcular posición Y basada en el price_max del level
      const levelTopY = priceToY(level.price_max);
      const bgY = levelTopY;

      // ✅ Skip solo si altura < 0.5px (muy pequeño para renderizar)
      if (levelHeight < 0.5) continue;

      // Calcular posición Y del texto (centrado en la celda)
      const priceMid = (level.price_min + level.price_max) / 2;
      const textY = bgY + levelHeight / 2;

      // Determine dominant side
      const bidDominates = level.bid_volume > level.ask_volume;
      const askDominates = level.ask_volume > level.bid_volume;

      // Color de fondo - si el level está vacío (sin volumen), usar color neutral
      const isEmpty = level.total_volume === 0;

      // Left side: BID
      const bidBg = isEmpty ? 'rgba(100, 100, 100, 0.15)' : (bidDominates ? this.colors.BID_BG_STRONG : this.colors.BID_BG_WEAK);
      ctx.fillStyle = bidBg;
      ctx.fillRect(x, bgY, halfWidth - 0.5, levelHeight - levelGap);

      // Right side: ASK
      const askBg = isEmpty ? 'rgba(100, 100, 100, 0.15)' : (askDominates ? this.colors.ASK_BG_STRONG : this.colors.ASK_BG_WEAK);
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

    // Position below the lowest level. Los niveles pueden venir en orden ascendente (backend)
    // o descendente (velas agregadas): levels[0] ponía el delta arriba, encima de las celdas.
    let lowestLevel = levels[0];
    for (const level of levels) {
      if (level.price_min < lowestLevel.price_min) lowestLevel = level;
    }
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

    // Footprint map for fast lookup (cached while the footprint list does not change)
    const fpMap = this._getFootprintMap();

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
