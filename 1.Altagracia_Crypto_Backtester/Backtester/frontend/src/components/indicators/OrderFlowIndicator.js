import { candleItemId } from './analysisLevels.js';
import { alignX, alignY, candleColumns, crispWidth, pixelRatio, snapEdge, snapSpanY } from '../chartPixels.js';
import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';
import { maskVolume } from '../backtesting/blindClock.js';
import { THEME, isCustom, isNewTheme } from '../uiTheme.js'; // Estilo Nítido

/** Valores de fábrica de lo visual que el estilo Nítido reemplaza. Lo que el usuario elige en el modal gana */
export const OF_FACTORY = { stackedBuyColor: '38,166,154', stackedSellColor: '239,83,80', fontSize: 9 };

// Fila de un nivel del footprint o del perfil en píxeles reales enteros: de su borde al del nivel
// siguiente, menos un hueco parejo de 1 px. Filas de menos de dos píxeles reales quedan como antes
function levelRow(top, levelHeight, height) {
  if ((levelHeight - 1) * pixelRatio() < 2) return [top, height];
  const start = snapEdge(top);
  return [start, snapEdge(top + levelHeight) - crispWidth(1) - start];
}

const MINUTES_BY_INTERVAL = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240 };
const MAX_CANDLES_TO_LOAD = 1600; // Con más velas en pantalla no se piden footprints: quedan a menos de 1 px por vela
const MAX_DAYS_TO_LOAD = 70; // Ni con más días de trades: el almacén lee un archivo por día (400 velas de 4h, unos 2 s)
const MAX_PAD_CANDLES = 200; // Velas de más a cada lado al desplazarse: media pantalla, hasta este tope
const DAY_MS = 86400000;
const MAX_FOOTPRINTS_IN_MEMORY = 6000;
const MIN_REQUEST_GAP_MS = 400;
const ERROR_WAIT_MS = 5000;
// Solo en vivo (la suite; App 1 reproduce con dias oficiales y no usa esto):
const LIVE_LAG_WAIT_MS = 10000; // el almacen va 1-2 min detras: si aun no llega a la hora pedida, se repide cada 10 s
const LIVE_REFRESH_MS = 60000; // y cada minuto se repiden las velas sin datos o con hueco: la nube puede llenarlas despues
const STEP_RESET_CHANGE = 0.3; // Si el precio se aleja 30% se elige otro step
const SETTINGS_KEY = 'orderflow_settings_';

/** Parámetros guardados de un símbolo; sin almacenamiento disponible quedan los de fábrica */
export function loadOrderFlowSettings(symbol) {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY + symbol)) || {};
  } catch {
    return {};
  }
}

export function saveOrderFlowSettings(symbol, settings) {
  try {
    localStorage.setItem(SETTINGS_KEY + symbol, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento los parámetros siguen vigentes hasta recargar
  }
}

/**
 * OrderFlowIndicator - Footprints sobre las velas, con el dibujo de App 9
 *
 * Los datos salen del almacén diario de trades de Bybit y se piden solo para las velas
 * visibles, cortados en la hora simulada. Con velas angostas quedan las líneas de stacked
 * imbalance. El sidebar consume datos vía getFootprintForTimestamp().
 */
class OrderFlowIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 7, backtestingMode = false, simulationStartTime = null) {
    super(symbol, interval, days);
    this.name = "Order Flow";
    this.height = 0; // Se dibuja sobre las velas, no ocupa panel propio
    this.backtestingMode = backtestingMode;
    this.simulationStartTime = simulationStartTime;

    this.tfMinutes = MINUTES_BY_INTERVAL[interval] || parseInt(interval, 10) || 1;
    this.tfMs = this.tfMinutes * 60000;

    this.footprintMap = new Map(); // Inicio de vela → footprint
    this.noData = new Map(); // Inicio de vela sin trades → hasta cuándo se consultó
    this.clock = null; // Hasta dónde se conoce la información
    this.generation = 0; // Invalida las respuestas pedidas antes de retroceder el tiempo
    this.stepSize = null;
    this.stepPrice = null;
    this.cellSize = null; // Celda guardada en el almacén: el step es múltiplo de ella

    this.isLoading = false;
    this.error = null;
    this.nextRequestAt = 0;
    this.retryTimer = null;

    this.config = { ...this.getDefaultConfig(), ...loadOrderFlowSettings(symbol) };

    // Orden de izquierda a derecha: Vela | Footprint (venta|compra) | Perfil
    this.layout = { candlePct: 0.20, footprintPct: 0.28, profilePct: 0.47, gapPct: 0.05 };

    this.colors = {
      PROFILE_BAR: 'rgba(100, 149, 237, 0.7)',
      PROFILE_POC: 'rgba(255, 215, 0, 0.9)',
      BID_BG_STRONG: 'rgba(183, 28, 28, 0.85)',
      BID_BG_WEAK: 'rgba(239, 154, 154, 0.6)',
      ASK_BG_STRONG: 'rgba(27, 94, 32, 0.85)',
      ASK_BG_WEAK: 'rgba(165, 214, 167, 0.6)',
      EMPTY_BG: 'rgba(100, 100, 100, 0.15)',
      TEXT: '#FFFFFF',
      TEXT_SHADOW: '#000000',
      CANDLE_UP: '#26A69A',
      CANDLE_DOWN: '#EF5350',
      CANDLE_WICK: '#666666',
      POC_LINE: '#FFD700',
      IMBALANCE_BORDER: '#FFD600'
    };
  }

  // ==================== CONFIGURACIÓN ====================

  getDefaultConfig() {
    return {
      enabled: true,
      showCandle: true,
      showProfile: true,
      profileMode: 'volume', // Perfil junto al footprint: 'volume', 'delta' o 'both' (volumen y al lado el delta)
      showFootprint: true,
      showPOC: true,
      showImbalances: true,
      showDelta: true,
      fontSize: 9,
      deltaFontSize: 13, // El delta se lee de lejos: va más grande que las cifras de las celdas
      minCandleWidth: 16, // Desde este ancho el footprint reemplaza la vela
      minCandleWidthFull: 60, // Desde este ancho se muestran cifras y delta
      stackedLineWidth: 2,
      stackedLineExtend: 3,
      stackedBuyColor: '38,166,154',
      stackedSellColor: '239,83,80',
      stackedOpacity: 0.7,
      stackedMinVolumeZScore: 0,
      showDeltaMarks: true,
      deltaMarkMinShare: 0.2, // Parte del volumen de la vela que debe ir contra su color
      stepByMinutes: {}, // Step elegido por marco, en minutos. Sin valor es automático
      maxLevels: 10, // Con step automático, niveles que puede tener una vela
      imbalanceRatio: 3,
      imbalanceMode: 'level', // 'level': mismo nivel. 'diagonal': compra contra la venta del nivel inferior
      // Filtros de imbalances (0 = sin filtro): volumen de la vela en % del promedio de las N velas anteriores,
      // y volumen de la celda (o de las celdas de un stacked) en % del volumen de su vela
      imbalanceCandleVolumePct: 0,
      imbalanceCandleVolumeBars: 20,
      imbalanceCellSharePct: 0,
      imbalanceCountZero: false, // Contar el nivel aunque el otro lado no tenga volumen
      stackedMinLevels: 3
    };
  }

  // Lo que cambia la respuesta del backend: si cambia, lo cargado ya no sirve
  _dataRules() {
    const { imbalanceRatio, imbalanceMode, imbalanceCandleVolumePct, imbalanceCandleVolumeBars, imbalanceCellSharePct, imbalanceCountZero, stackedMinLevels, maxLevels } = this.config;
    return JSON.stringify([this._stepOverride(), imbalanceRatio, imbalanceMode, imbalanceCandleVolumePct, imbalanceCandleVolumeBars, imbalanceCellSharePct, imbalanceCountZero, stackedMinLevels, maxLevels]);
  }

  _stepOverride() {
    return this.config.stepByMinutes?.[this.tfMinutes] || null;
  }

  updateConfig(newConfig) {
    const before = this._dataRules();
    this.config = { ...this.config, ...newConfig };
    if (this._dataRules() !== before) this._reset();
  }

  /** Color "r, g, b" del stacked con Nítido: el del modal si el usuario lo eligió, si no el del estilo */
  _stackedRgb(key, themeRgb) {
    return isCustom(this.config, key, OF_FACTORY[key]) ? this.config[key] : themeRgb;
  }

  // ==================== DATOS ====================

  // Los footprints se piden al dibujar, según las velas visibles
  async fetchData() {
    return null;
  }

  get footprints() {
    return Array.from(this.footprintMap.values());
  }

  hasFootprintData() {
    return this.footprintMap.size > 0;
  }

  _reset() {
    this.footprintMap.clear();
    this.noData.clear();
    this.stepSize = null;
    this.stepPrice = null;
    this.generation += 1;
  }

  // Al retroceder el tiempo se descarta lo que solo se conocía en una hora posterior
  _syncClock(knownUntil, price) {
    if (this.stepPrice && Math.abs(price / this.stepPrice - 1) > STEP_RESET_CHANGE) {
      this._reset();
    } else if (this.clock !== null && knownUntil < this.clock) {
      this.generation += 1;
      for (const timestamp of this.footprintMap.keys()) {
        if (timestamp + this.tfMs > knownUntil) this.footprintMap.delete(timestamp);
      }
    }
    this.clock = knownUntil;
  }

  _needsData(candle) {
    // En vivo la vela en curso no trae knownUntil: se pide hasta la hora del grafico (ahora)
    const forming = candle.in_progress ? (candle.knownUntil ?? (this.backtestingMode ? undefined : this.clock)) : null;
    const target = candle.in_progress ? forming : candle.timestamp + this.tfMs;
    const seen = this.footprintMap.get(candle.timestamp)?.knownUntil ?? this.noData.get(candle.timestamp) ?? 0;
    return seen < target;
  }

  /** Vista que se puede cargar: hasta MAX_CANDLES_TO_LOAD velas y MAX_DAYS_TO_LOAD días de trades */
  _canLoad(visibleCandles) {
    if (visibleCandles.length > MAX_CANDLES_TO_LOAD) return false;
    const span = visibleCandles[visibleCandles.length - 1].timestamp + this.tfMs - visibleCandles[0].timestamp;
    return span <= MAX_DAYS_TO_LOAD * DAY_MS;
  }

  _loadVisible(visibleCandles, priceContext) {
    const { knownUntil, requestRedraw } = priceContext;
    if (!knownUntil) return;

    this._syncClock(knownUntil, visibleCandles[visibleCandles.length - 1].close);
    if (!this._canLoad(visibleCandles)) return;
    if (!this.backtestingMode) this._liveRefresh();

    const missing = visibleCandles.filter(candle => this._needsData(candle));
    if (missing.length === 0) return;

    // Al desplazarse se trae media pantalla de más a cada lado, sin pasar del tope de velas ni de días
    // por pedido; una vela que avanza solo se pide a sí misma
    const first = missing[0].timestamp;
    const last = missing[missing.length - 1].timestamp + this.tfMs;
    const room = Math.floor(Math.max(0, MAX_DAYS_TO_LOAD * DAY_MS - (last - first)) / 2 / this.tfMs);
    const pad = missing.length > 4 ? Math.min(Math.ceil(visibleCandles.length / 2), MAX_PAD_CANDLES, room) * this.tfMs : 0;
    this._request(first - pad, last + pad, knownUntil, requestRedraw);
  }

  /**
   * En vivo, cada minuto: las velas sin datos y las que tocan un hueco de grabacion se vuelven a pedir.
   * La nube baja cada 15 minutos y puede llenar horas que antes no tenian trades; sin esto quedaban vacias
   * hasta recargar la pagina. Lo ya dibujado se sigue viendo mientras llega lo nuevo.
   */
  _liveRefresh() {
    const now = performance.now();
    if (now - (this.lastLiveRefresh || 0) < LIVE_REFRESH_MS) return;
    this.lastLiveRefresh = now;
    this.noData.clear();
    for (const footprint of this.footprintMap.values()) {
      if (footprint.gap) footprint.knownUntil = 0;
    }
  }

  _request(start, end, knownUntil, redraw) {
    if (this.isLoading) return; // Al terminar se redibuja y se vuelve a evaluar

    const wait = this.nextRequestAt - performance.now();
    if (wait > 0) {
      if (!this.retryTimer) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          redraw?.();
        }, wait);
      }
      return;
    }

    this.isLoading = true;
    this.nextRequestAt = performance.now() + MIN_REQUEST_GAP_MS;
    const generation = this.generation;

    const params = new URLSearchParams({
      interval: String(this.tfMinutes),
      start_timestamp: String(start),
      end_timestamp: String(end),
      known_until: String(knownUntil)
    });
    const step = this._stepOverride() || this.stepSize;
    if (step) params.append('step', String(step));
    if (!this.backtestingMode && !this._stepOverride()) {
      // En vivo (suite) el step automatico es parejo: el servidor lo saca del rango tipico de las velas
      // y vale para todas; sin tope de niveles por vela, que daba a cada vela su propio step
      params.append('step_mode', 'uniform');
    } else if (!this._stepOverride()) {
      params.append('max_levels', String(this.config.maxLevels));
    }
    params.append('imbalance_ratio', String(this.config.imbalanceRatio));
    params.append('imbalance_mode', this.config.imbalanceMode);
    // El mínimo en monedas de antes ya no se envía: ahora los filtros son relativos
    params.append('imbalance_candle_pct', String(this.config.imbalanceCandleVolumePct || 0));
    params.append('imbalance_candle_bars', String(this.config.imbalanceCandleVolumeBars || 20));
    params.append('imbalance_cell_pct', String(this.config.imbalanceCellSharePct || 0));
    params.append('imbalance_zero', String(this.config.imbalanceCountZero));
    params.append('stacked_levels', String(this.config.stackedMinLevels));

    fetch(`${API_BASE_URL}/api/orderflow/historical/${this.symbol}?${params}`)
      .then(response => {
        if (!response.ok) throw new Error(`Error ${response.status}`);
        return response.json();
      })
      .then(data => {
        if (!data.success) throw new Error(data.message || 'Sin respuesta del almacén');
        if (generation === this.generation) this._store(data, start, end);
        // En vivo el almacen va detras de la hora pedida: no se repide hasta dentro de 10 s
        if (!this.backtestingMode && data.known_until < knownUntil) {
          this.nextRequestAt = performance.now() + LIVE_LAG_WAIT_MS;
        }
        this.error = null;
        this.isLoading = false;
        redraw?.();
      })
      .catch(error => {
        if (this.error !== error.message) {
          console.error(`[${this.symbol}] ❌ Error loading Order Flow:`, error);
        }
        this.error = error.message;
        this.isLoading = false;
        this.nextRequestAt = performance.now() + ERROR_WAIT_MS;
      });
  }

  _store(data, start, end) {
    const known = data.known_until;
    if (data.cell_size) this.cellSize = data.cell_size;

    data.footprints.forEach(footprint => {
      footprint.knownUntil = known;
      this.footprintMap.delete(footprint.candle_timestamp);
      this.footprintMap.set(footprint.candle_timestamp, footprint);
      this.noData.delete(footprint.candle_timestamp);
    });

    for (let timestamp = start; timestamp < end; timestamp += this.tfMs) {
      if (!this.footprintMap.has(timestamp)) this.noData.set(timestamp, known);
    }

    // Un solo step en la sesión, para que todas las celdas midan lo mismo
    if (!this.stepSize && data.step_size && data.footprints.length > 0) {
      this.stepSize = data.step_size;
      this.stepPrice = data.footprints[data.footprints.length - 1].candle_close;
    }

    while (this.footprintMap.size > MAX_FOOTPRINTS_IN_MEMORY) {
      this.footprintMap.delete(this.footprintMap.keys().next().value);
    }
  }

  destroy() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.generation += 1;
  }

  // ==================== DIBUJO ====================

  /** El footprint reemplaza la vela solo si hay datos y la vela es ancha */
  shouldReplaceCandles(candleWidth = 0) {
    return this.enabled && this.config.enabled && this.hasFootprintData() && candleWidth >= this.config.minCandleWidth;
  }

  /** Rango de precio de los niveles visibles, para que entren completos en la escala */
  priceExtent(visibleCandles) {
    let low = Infinity;
    let high = -Infinity;
    for (const candle of visibleCandles) {
      const levels = this.footprintMap.get(candle.timestamp)?.levels;
      if (!levels?.length) continue;
      low = Math.min(low, levels[0].price_min);
      high = Math.max(high, levels[levels.length - 1].price_max);
    }
    return low < high ? { low, high } : null;
  }

  /** Delta real de cada vela, solo si todas las velas dadas ya lo tienen */
  realDeltas(candles) {
    if (!this.enabled || !this.config.enabled || candles.length > MAX_CANDLES_TO_LOAD) return null;

    const deltas = [];
    for (const candle of candles) {
      const footprint = this.footprintMap.get(candle.timestamp);
      if (!footprint) return null;
      deltas.push(footprint.total_delta);
    }
    return deltas;
  }

  /** Compra agresiva en una vela roja, o venta agresiva en una vela verde */
  deltaAgainstCandle(footprint, candle) {
    const move = candle.close - candle.open;
    const delta = footprint.total_delta;
    return move * delta < 0 && Math.abs(delta) >= footprint.total_volume * this.config.deltaMarkMinShare;
  }

  /** POC, stacked e imbalances a la vista, y marcas de delta contrario, para elegirlos con un clic */
  selectableLevels() {
    return this.targets;
  }

  _target(kind, candle, price, geometry, extra = {}) {
    const id = candleItemId('Order Flow', kind, candle.timestamp, price, this.interval);
    this.targets.push({ id, source: 'Order Flow', kind, price, time: candle.timestamp, ...extra, ...geometry });
  }

  // Zona de precio de unos niveles del footprint
  _span(footprint, indexes) {
    const levels = indexes.map(index => footprint.levels[index]).filter(Boolean);
    if (!levels.length) return null;
    const low = Math.min(...levels.map(level => level.price_min));
    const high = Math.max(...levels.map(level => level.price_max));
    return { low, high, price: (low + high) / 2 };
  }

  _stackedShown(footprint) {
    const minZScore = this.config.stackedMinVolumeZScore || 0;
    if (minZScore > 0 && (footprint.volume_zscore || 0) < minZScore) return [];
    return footprint.stacked_imbalances || [];
  }

  /** Lo que se puede elegir en una vela con su footprint a la vista. No dibuja nada más */
  _unitTargets(candle, footprint, unitX, unitWidth, cells, priceToY, fullMode) {
    const { levels, poc_index: pocIndex } = footprint;
    const unit = { left: unitX, right: unitX + unitWidth };

    const poc = levels[pocIndex];
    if (poc) {
      const price = poc.price_mid ?? (poc.price_min + poc.price_max) / 2;
      this._target('POC de la vela', candle, price, { ...unit, y: priceToY(price) });
    }

    const inStacked = new Set();
    for (const stacked of this._stackedShown(footprint)) {
      const span = this._span(footprint, stacked.levels || []);
      if (!span) continue;
      (stacked.levels || []).forEach(index => inStacked.add(index));
      const kind = stacked.direction === 'BUY' ? 'Stacked de compra' : 'Stacked de venta';
      this._target(kind, candle, span.price, { ...cells, top: priceToY(span.high), bottom: priceToY(span.low) }, { low: span.low, high: span.high });
    }

    if (!fullMode) return;
    for (const imbalance of footprint.imbalances || []) {
      if (inStacked.has(imbalance.level_index)) continue;
      const span = this._span(footprint, [imbalance.level_index]);
      if (!span) continue;
      const kind = imbalance.type === 'BUY' ? 'Imbalance de compra' : 'Imbalance de venta';
      this._target(kind, candle, span.price, { ...cells, top: priceToY(span.high), bottom: priceToY(span.low) }, { low: span.low, high: span.high });
    }
  }

  renderOnChart(ctx, bounds, visibleCandles, priceContext, replacesCandles) {
    this.targets = [];
    if (!this.enabled || !this.config.enabled || visibleCandles.length === 0) return;

    this._loadVisible(visibleCandles, priceContext);

    const { priceToY } = priceContext;
    const candleWidth = bounds.width / visibleCandles.length;
    const fullMode = candleWidth >= this.config.minCandleWidthFull;

    ctx.save();
    ctx.beginPath();
    ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.clip();

    if (replacesCandles) {
      visibleCandles.forEach((candle, i) => {
        const unitX = bounds.x + i * candleWidth;
        const footprint = this.footprintMap.get(candle.timestamp);
        if (footprint?.levels?.length) {
          this.renderOrderFlowUnit(ctx, candle, footprint, unitX, candleWidth, priceToY, fullMode, bounds);
        } else {
          this.renderSimpleCandle(ctx, candle, unitX, candleWidth, priceToY);
        }
      });
      if (this.config.showImbalances) this.renderStackedBands(ctx, bounds, visibleCandles, candleWidth, priceToY);
    } else if (candleWidth < this.config.minCandleWidth) {
      this.renderImbalanceMarkers(ctx, bounds, visibleCandles, priceToY, candleWidth);
    }

    this._renderNotice(ctx, bounds, visibleCandles);
    ctx.restore();
  }

  _renderNotice(ctx, bounds, visibleCandles) {
    let text = null;
    if (this.error) {
      text = 'Order Flow: no se pudo leer el almacén de trades';
    } else if (!this._canLoad(visibleCandles)) {
      // Lo ya cargado se sigue dibujando; lo demás espera a que la vista tenga menos velas
      if (visibleCandles.some(candle => !this.footprintMap.has(candle.timestamp) && !this.noData.has(candle.timestamp))) {
        text = 'Order Flow: acerca el zoom para cargar los footprints';
      }
    } else if (!this.isLoading
      && visibleCandles.every(candle => !this.footprintMap.has(candle.timestamp) && this.noData.has(candle.timestamp))) {
      text = 'Order Flow: sin trades descargados para este rango';
    }
    if (!text) return;

    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#9E9E9E';
    ctx.fillText(text, bounds.x + 8, bounds.y + 6);
  }

  /** Vela sencilla cuando esa vela no tiene footprint */
  renderSimpleCandle(ctx, candle, x, width, priceToY) {
    const margin = width * 0.1;
    const bodyWidth = width - margin * 2;
    const centerX = x + width / 2;
    const rising = candle.close >= candle.open;
    const color = isNewTheme() ? (rising ? THEME.up : THEME.down) : (rising ? this.colors.CANDLE_UP : this.colors.CANDLE_DOWN);

    const openY = priceToY(candle.open);
    const closeY = priceToY(candle.close);
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(1, Math.max(openY, closeY) - bodyTop);

    ctx.strokeStyle = isNewTheme() ? color : this.colors.CANDLE_WICK;
    ctx.lineWidth = crispWidth(1, 'x');
    ctx.beginPath();
    ctx.moveTo(alignX(centerX), snapEdge(priceToY(candle.high)));
    ctx.lineTo(alignX(centerX), snapEdge(priceToY(candle.low)));
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.fillRect(x + margin, bodyTop, bodyWidth, bodyHeight);
  }

  /** Niveles vacíos para llegar a los extremos de la vela oficial, que pueden no tener trades */
  _levelsToCoverCandle(footprint, candle) {
    const { levels, step_size: step } = footprint;
    const extra = [];
    if (!(step > 0)) return extra;

    for (let top = levels[levels.length - 1].price_max; top < candle.high; top += step) {
      extra.push({ price_min: top, price_max: top + step });
    }
    for (let bottom = levels[0].price_min; bottom > candle.low; bottom -= step) {
      extra.push({ price_min: bottom - step, price_max: bottom });
    }
    return extra;
  }

  /** Vela | Footprint | Perfil de una vela */
  renderOrderFlowUnit(ctx, candle, footprint, unitX, unitWidth, priceToY, fullMode, bounds) {
    const gap = unitWidth * this.layout.gapPct / 3;
    const candleWidth = unitWidth * this.layout.candlePct;
    const candleX = unitX + gap;
    const footprintWidth = unitWidth * this.layout.footprintPct;
    const footprintX = candleX + candleWidth + gap;
    const profileWidth = unitWidth * this.layout.profilePct;
    const profileX = footprintX + footprintWidth + gap;

    const { levels } = footprint;
    const extraLevels = this._levelsToCoverCandle(footprint, candle);
    const high = extraLevels.reduce((max, level) => Math.max(max, level.price_max), levels[levels.length - 1].price_max);
    const low = extraLevels.reduce((min, level) => Math.min(min, level.price_min), levels[0].price_min);

    if (this.config.showCandle) {
      this.renderJapaneseCandle(ctx, candle, candleX, candleWidth, priceToY, high, low);
    }
    if (this.config.showFootprint) {
      this.renderFootprint(ctx, footprint, extraLevels, footprintX, footprintWidth, priceToY, fullMode, unitX, bounds);
    }
    if (this.config.showProfile) {
      const mode = this.config.profileMode || 'volume';
      if (mode === 'both') {
        // Volumen y al lado el delta, cada uno en la mitad del espacio del perfil
        const half = (profileWidth - gap) / 2;
        this.renderVolumeProfile(ctx, footprint, profileX, half, priceToY, bounds);
        this.renderDeltaProfile(ctx, footprint, profileX + half + gap, half, priceToY, bounds);
      } else if (mode === 'delta') {
        this.renderDeltaProfile(ctx, footprint, profileX, profileWidth, priceToY, bounds);
      } else {
        this.renderVolumeProfile(ctx, footprint, profileX, profileWidth, priceToY, bounds);
      }
    }
    if (this.config.showDelta && fullMode) {
      this.renderDelta(ctx, footprint, unitX, unitWidth, low, priceToY);
    }
    // Dia en vivo (suite) con un hueco de grabacion en esta vela: sus trades estan incompletos
    if (footprint.gap && footprintWidth >= 24) {
      this.renderPartialMark(ctx, footprintX, footprintWidth, priceToY(high));
    }

    this._unitTargets(candle, footprint, unitX, unitWidth, { left: footprintX, right: footprintX + footprintWidth }, priceToY, fullMode);
  }

  /** Aviso sobre el footprint de una vela que la grabacion no cubrio entera (App 1 no lo usa: sus dias son oficiales) */
  renderPartialMark(ctx, x, width, topY) {
    ctx.save();
    ctx.font = `600 10px ${isNewTheme() ? THEME.font : 'Arial'}`;
    ctx.fillStyle = isNewTheme() ? THEME.textMuted : '#888';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('parcial', x + width / 2, topY - 3);
    ctx.restore();
  }

  renderJapaneseCandle(ctx, candle, x, width, priceToY, high, low) {
    const centerX = x + width / 2;
    const bodyWidth = Math.max(2, width * 0.6);
    const rising = candle.close >= candle.open;
    const color = isNewTheme() ? (rising ? THEME.up : THEME.down) : (rising ? this.colors.CANDLE_UP : this.colors.CANDLE_DOWN);

    const openY = priceToY(candle.open);
    const closeY = priceToY(candle.close);
    const bodyTop = Math.min(openY, closeY);
    const bodyBottom = Math.max(openY, closeY);
    const bodyHeight = Math.max(1, bodyBottom - bodyTop);

    // En píxeles reales enteros: el cuerpo con su borde de 1 px, como antes, y la mecha al centro
    const columns = candleColumns(centerX, bodyWidth + 1);
    if (columns) {
      const [wickY, wickHeight] = snapSpanY(priceToY(high), priceToY(low));
      const [bodyY, bodyHeightPx] = snapSpanY(bodyTop - 0.5, bodyTop + bodyHeight + 0.5);
      ctx.fillStyle = color;
      ctx.fillRect(columns.wickX, wickY, columns.wickWidth, wickHeight);
      ctx.fillRect(columns.bodyX, bodyY, columns.bodyWidth, bodyHeightPx);
      return;
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, priceToY(high));
    ctx.lineTo(centerX, bodyTop);
    ctx.moveTo(centerX, bodyBottom);
    ctx.lineTo(centerX, priceToY(low));
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.fillRect(centerX - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
    ctx.strokeRect(centerX - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
  }

  /** Barras horizontales con el volumen de cada nivel */
  renderVolumeProfile(ctx, footprint, x, width, priceToY, bounds) {
    const { levels, poc_index: pocIndex } = footprint;
    const maxVolume = levels.reduce((max, level) => Math.max(max, level.total_volume), 0);
    if (maxVolume === 0) return;

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const topY = priceToY(level.price_max);
      const levelHeight = Math.abs(priceToY(level.price_min) - topY);
      if (levelHeight < 0.5 || topY > bounds.y + bounds.height || topY + levelHeight < bounds.y) continue;

      const barWidth = width * (level.total_volume / maxVolume);
      const isPOC = i === pocIndex;
      if (isNewTheme()) {
        ctx.fillStyle = isPOC ? THEME.fpPoc : THEME.fpProfile;
      } else {
        ctx.fillStyle = isPOC ? this.colors.PROFILE_POC : this.colors.PROFILE_BAR;
      }
      // Barra de borde a borde del nivel en píxeles reales, con un hueco parejo de 1 px
      const [barY, barHeight] = levelRow(topY, levelHeight, Math.max(1, levelHeight - 1));
      ctx.fillRect(x, barY, barWidth, barHeight);

      if (isPOC && this.config.showPOC && !isNewTheme()) {
        ctx.strokeStyle = this.colors.POC_LINE;
        ctx.lineWidth = crispWidth(2);
        ctx.beginPath();
        ctx.moveTo(x, alignY(topY + levelHeight / 2, 2));
        ctx.lineTo(x + barWidth, alignY(topY + levelHeight / 2, 2));
        ctx.stroke();
      }
    }
  }

  /**
   * Delta de cada nivel (compra menos venta) como barras desde la izquierda: largo según el mayor |delta|
   * de la vela, con el color del lado que ganó en ese nivel.
   */
  renderDeltaProfile(ctx, footprint, x, width, priceToY, bounds) {
    const { levels } = footprint;
    const deltaOf = level => level.delta ?? (level.ask_volume - level.bid_volume);
    const maxDelta = levels.reduce((max, level) => Math.max(max, Math.abs(deltaOf(level))), 0);
    if (!(maxDelta > 0) || width < 1) return;

    const buyRgb = isNewTheme() ? THEME.fpBuyRgb : '38, 166, 154';
    const sellRgb = isNewTheme() ? THEME.fpSellRgb : '239, 83, 80';
    for (const level of levels) {
      const delta = deltaOf(level);
      if (Math.abs(delta) < 1e-9) continue;
      const topY = priceToY(level.price_max);
      const levelHeight = Math.abs(priceToY(level.price_min) - topY);
      if (levelHeight < 0.5 || topY > bounds.y + bounds.height || topY + levelHeight < bounds.y) continue;

      ctx.fillStyle = `rgba(${delta >= 0 ? buyRgb : sellRgb}, ${isNewTheme() ? 0.7 : 0.8})`;
      const [barY, barHeight] = levelRow(topY, levelHeight, Math.max(1, levelHeight - 1));
      ctx.fillRect(x, barY, Math.max(1, width * Math.abs(delta) / maxDelta), barHeight);
    }
  }

  /**
   * Franjas de los stacked con el footprint a la vista: desde la vela hacia la derecha, tantos anchos de vela
   * como "Largo" en el modal, con borde arriba y abajo. Van encima de las celdas, tenues para que se lean las cifras.
   */
  renderStackedBands(ctx, bounds, visibleCandles, candleWidth, priceToY) {
    const { stackedLineExtend, stackedOpacity } = this.config;
    const opacity = stackedOpacity ?? 0.7;
    const buyRgb = isNewTheme() ? this._stackedRgb('stackedBuyColor', THEME.fpBuyRgb) : this.config.stackedBuyColor;
    const sellRgb = isNewTheme() ? this._stackedRgb('stackedSellColor', THEME.fpSellRgb) : this.config.stackedSellColor;
    const right = bounds.x + bounds.width;

    visibleCandles.forEach((candle, i) => {
      const footprint = this.footprintMap.get(candle.timestamp);
      if (!footprint?.levels?.length) return;
      const unitX = bounds.x + i * candleWidth;
      // En el Clásico la vela ya pinta su franja: se agrega solo lo que sigue a la derecha
      const startX = isNewTheme() ? unitX : unitX + candleWidth;
      const endX = Math.min(right, unitX + candleWidth * Math.max(1, stackedLineExtend || 1));
      if (endX <= startX) return;

      for (const stacked of this._stackedShown(footprint)) {
        const span = this._span(footprint, stacked.levels || []);
        if (!span) continue;
        const rgb = stacked.direction === 'BUY' ? buyRgb : sellRgb;
        const [top, height] = snapSpanY(priceToY(span.high), priceToY(span.low));
        if (top > bounds.y + bounds.height || top + height < bounds.y) continue;
        ctx.fillStyle = `rgba(${rgb}, ${opacity * 0.22})`;
        ctx.fillRect(startX, top, endX - startX, height);
        ctx.strokeStyle = `rgba(${rgb}, ${Math.min(1, opacity * 1.2)})`;
        ctx.lineWidth = crispWidth(1);
        ctx.beginPath();
        ctx.moveTo(startX, alignY(top, 1));
        ctx.lineTo(endX, alignY(top, 1));
        ctx.moveTo(startX, alignY(top + height, 1));
        ctx.lineTo(endX, alignY(top + height, 1));
        ctx.stroke();
      }
    });
  }

  /**
   * Estilo Nítido: el color de cada celda crece con su volumen, como en ATAS. Casi todo queda
   * pálido y lo grande resalta; cifras sin contorno, desequilibrios en negrita y un marco fino.
   */
  renderFootprintGraded(ctx, footprint, extraLevels, x, width, priceToY, fullMode, unitX, bounds) {
    const { levels, step_size: step } = footprint;
    const imbalances = new Map((footprint.imbalances || []).map(item => [item.level_index, item.type]));

    const stackedSet = new Map();
    const minZScore = this.config.stackedMinVolumeZScore || 0;
    if (minZScore <= 0 || (footprint.volume_zscore || 0) >= minZScore) {
      for (const stacked of footprint.stacked_imbalances || []) {
        for (const index of stacked.levels || []) stackedSet.set(index, stacked.direction);
      }
    }

    const halfWidth = width / 2;
    const reference = levels[0].price_max;
    const levelHeight = Math.max(Math.abs(priceToY(reference - step) - priceToY(reference)), 1.5);
    const cellHeight = levelHeight - 1;
    const isOutside = y => y > bounds.y + bounds.height || y + levelHeight < bounds.y;
    const maxSide = levels.reduce((max, level) => Math.max(max, level.bid_volume, level.ask_volume), 0) || 1;
    const ink = volume => (volume > 0 ? 0.07 + 0.5 * Math.pow(volume / maxSide, 0.8) : 0);

    let top = Infinity;
    let bottom = -Infinity;
    for (const level of extraLevels) {
      const y = priceToY(level.price_max);
      if (isOutside(y)) continue;
      const [cellY, cellH] = levelRow(y, levelHeight, cellHeight);
      ctx.fillStyle = THEME.fpEmpty;
      ctx.fillRect(x, cellY, width, cellH);
      top = Math.min(top, cellY);
      bottom = Math.max(bottom, cellY + cellH);
    }

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const y = priceToY(level.price_max);
      if (isOutside(y)) continue;

      const [cellY, cellH] = levelRow(y, levelHeight, cellHeight);
      top = Math.min(top, cellY);
      bottom = Math.max(bottom, cellY + cellH);
      const textY = y + levelHeight / 2;
      const imbalance = this.config.showImbalances ? imbalances.get(i) : null;

      const sellInk = ink(level.bid_volume) + (imbalance === 'SELL' ? 0.12 : 0);
      const buyInk = ink(level.ask_volume) + (imbalance === 'BUY' ? 0.12 : 0);
      ctx.fillStyle = level.bid_volume > 0 ? `rgba(${THEME.fpSellRgb}, ${sellInk})` : THEME.fpEmpty;
      ctx.fillRect(x, cellY, halfWidth - 0.5, cellH);
      ctx.fillStyle = level.ask_volume > 0 ? `rgba(${THEME.fpBuyRgb}, ${buyInk})` : THEME.fpEmpty;
      ctx.fillRect(x + halfWidth + 0.5, cellY, halfWidth - 0.5, cellH);

      // Stacked: una barra de 2 px en el lado que empuja y una franja tenue por detrás de la vela,
      // con el color y la opacidad del modal del Order Flow si el usuario los eligió
      if (this.config.showImbalances && stackedSet.has(i)) {
        const buying = stackedSet.get(i) === 'BUY';
        const rgb = buying ? this._stackedRgb('stackedBuyColor', THEME.fpBuyRgb) : this._stackedRgb('stackedSellColor', THEME.fpSellRgb);
        const opacity = this.config.stackedOpacity ?? 0.7;
        ctx.fillStyle = `rgba(${rgb}, ${Math.min(1, opacity / 0.7)})`;
        ctx.fillRect(buying ? x + width - 2 : x, cellY, 2, cellH);
        // La franja, desde la vela hacia la derecha, la dibuja renderStackedBands después de todas las velas
      } else if (imbalance) {
        // Imbalance suelto: la misma barra de 2 px, más tenue, así se ve también sin cifras
        const rgb = imbalance === 'BUY' ? THEME.fpBuyRgb : THEME.fpSellRgb;
        ctx.fillStyle = `rgba(${rgb}, 0.6)`;
        ctx.fillRect(imbalance === 'BUY' ? x + width - 2 : x, cellY, 2, cellH);
      }

      if (fullMode && width >= 30 && levelHeight >= 10) {
        // El tamaño elegido en el modal del Order Flow gana; si no, el del estilo
        const size = isCustom(this.config, 'fontSize', OF_FACTORY.fontSize) ? this.config.fontSize : THEME.fontSize;
        const fontSize = Math.min(size, levelHeight - 2);
        ctx.textBaseline = 'middle';
        const write = (volume, strong, color, align, textX) => {
          ctx.font = `${strong ? '700' : '400'} ${fontSize}px ${THEME.font}`;
          ctx.fillStyle = strong ? color : (volume / maxSide < 0.2 ? THEME.fpTextFaint : THEME.fpText);
          ctx.textAlign = align;
          ctx.fillText(this.formatVolumeShort(volume), textX, textY);
        };
        if (level.bid_volume > 0) write(level.bid_volume, imbalance === 'SELL', THEME.fpImbDownText, 'right', x + halfWidth - 3);
        if (level.ask_volume > 0) write(level.ask_volume, imbalance === 'BUY', THEME.fpImbUpText, 'left', x + halfWidth + 3);
      }
    }

    // Un solo marco fino alrededor del footprint
    if (top < bottom) {
      ctx.strokeStyle = THEME.fpFrame;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 1, top - 1, width + 2, bottom - top + 2);
    }
  }

  formatVolumeShort(volume) {
    volume = maskVolume(volume);
    const abs = Math.abs(volume);
    if (abs >= 1000000) return (volume / 1000000).toFixed(1) + 'M';
    if (abs >= 1000) return (volume / 1000).toFixed(1) + 'K';
    if (abs >= 100) return Math.round(volume).toString();
    if (abs < 0.05) return '0';
    return volume.toFixed(1);
  }

  /** Celdas de venta (izquierda) y compra (derecha) por nivel */
  renderFootprint(ctx, footprint, extraLevels, x, width, priceToY, fullMode, unitX, bounds) {
    if (isNewTheme()) return this.renderFootprintGraded(ctx, footprint, extraLevels, x, width, priceToY, fullMode, unitX, bounds);
    const { levels, poc_index: pocIndex, step_size: step } = footprint;
    const imbalanceSet = new Set((footprint.imbalances || []).map(item => item.level_index));

    const stackedSet = new Map(); // Índice de nivel → dirección
    const minZScore = this.config.stackedMinVolumeZScore || 0;
    if (minZScore <= 0 || (footprint.volume_zscore || 0) >= minZScore) {
      for (const stacked of footprint.stacked_imbalances || []) {
        for (const index of stacked.levels || []) stackedSet.set(index, stacked.direction);
      }
    }

    const halfWidth = width / 2;
    const levelGap = 1;
    // Una sola altura para todas las celdas: la que mide un step en la escala actual
    const reference = levels[0].price_max;
    const levelHeight = Math.max(Math.abs(priceToY(reference - step) - priceToY(reference)), 1.5);
    const cellHeight = levelHeight - levelGap;
    const isOutside = y => y > bounds.y + bounds.height || y + levelHeight < bounds.y;

    for (const level of extraLevels) {
      const y = priceToY(level.price_max);
      if (isOutside(y)) continue;
      const [cellY, cellH] = levelRow(y, levelHeight, cellHeight);
      ctx.fillStyle = this.colors.EMPTY_BG;
      ctx.fillRect(x, cellY, width, cellH);
    }

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const y = priceToY(level.price_max);
      if (isOutside(y)) continue;

      // La celda va de borde a borde de su nivel en píxeles reales, con un hueco parejo de 1 px
      const [cellY, cellH] = levelRow(y, levelHeight, cellHeight);
      const textY = y + levelHeight / 2;
      const isEmpty = level.total_volume === 0;
      const sellDominates = level.bid_volume > level.ask_volume;
      const buyDominates = level.ask_volume > level.bid_volume;

      ctx.fillStyle = isEmpty ? this.colors.EMPTY_BG : (sellDominates ? this.colors.BID_BG_STRONG : this.colors.BID_BG_WEAK);
      ctx.fillRect(x, cellY, halfWidth - 0.5, cellH);

      ctx.fillStyle = isEmpty ? this.colors.EMPTY_BG : (buyDominates ? this.colors.ASK_BG_STRONG : this.colors.ASK_BG_WEAK);
      ctx.fillRect(x + halfWidth + 0.5, cellY, halfWidth - 0.5, cellH);

      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, cellY, width, cellH);

      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = crispWidth(1, 'x');
      ctx.beginPath();
      ctx.moveTo(alignX(x + halfWidth), cellY);
      ctx.lineTo(alignX(x + halfWidth), cellY + cellH);
      ctx.stroke();

      if (this.config.showPOC && i === pocIndex) {
        ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
        ctx.fillRect(x, textY - 1, width, 2);
      }

      if (this.config.showImbalances && stackedSet.has(i)) {
        const rgb = stackedSet.get(i) === 'BUY' ? this.config.stackedBuyColor : this.config.stackedSellColor;
        const opacity = this.config.stackedOpacity;

        ctx.fillStyle = `rgba(${rgb}, ${opacity * 0.4})`;
        ctx.fillRect(x, cellY, width, cellH);
        ctx.strokeStyle = `rgba(${rgb}, 0.95)`;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, cellY, width, cellH);

        // La franja sigue hacia la izquierda, por detrás de la vela
        const extendLeft = x - unitX;
        if (extendLeft > 0) {
          ctx.fillStyle = `rgba(${rgb}, ${opacity * 0.6})`;
          ctx.fillRect(unitX, cellY, extendLeft, cellH);
          ctx.strokeStyle = `rgba(${rgb}, ${opacity * 0.8})`;
          ctx.lineWidth = 1;
          ctx.strokeRect(unitX, cellY, extendLeft, cellH);
        }
      } else if (this.config.showImbalances && imbalanceSet.has(i) && levelHeight >= 6) {
        // En celdas muy bajas el borde taparía el color de la celda
        ctx.strokeStyle = this.colors.IMBALANCE_BORDER;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, cellY, width, cellH);
      }

      if (fullMode && width >= 30 && levelHeight >= 10) {
        const fontSize = Math.min(this.config.fontSize, levelHeight - 2, 11);
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = this.colors.TEXT;

        if (level.bid_volume > 0) {
          ctx.textAlign = 'right';
          this.drawTextWithShadow(ctx, this.formatVolume(level.bid_volume), x + halfWidth - 2, textY);
        }
        if (level.ask_volume > 0) {
          ctx.textAlign = 'left';
          this.drawTextWithShadow(ctx, this.formatVolume(level.ask_volume), x + halfWidth + 3, textY);
        }
      }
    }
  }

  /** Delta total debajo de la vela */
  renderDelta(ctx, footprint, unitX, unitWidth, lowestPrice, priceToY) {
    const delta = footprint.total_delta;
    if (Math.abs(delta) < 0.001) return;

    if (isNewTheme()) {
      // Sin contorno: el color ya dice el lado
      ctx.font = `600 ${this.config.deltaFontSize ?? this.config.fontSize}px ${THEME.font}`;
      ctx.fillStyle = delta >= 0 ? THEME.upText : THEME.downText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(delta >= 0 ? `+${this.formatVolumeShort(delta)}` : this.formatVolumeShort(delta), unitX + unitWidth / 2, priceToY(lowestPrice) + 14);
      return;
    }

    ctx.font = `bold ${this.config.deltaFontSize ?? this.config.fontSize}px Arial`;
    ctx.fillStyle = delta >= 0 ? this.colors.CANDLE_UP : this.colors.CANDLE_DOWN;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const text = delta >= 0 ? `+${this.formatVolume(delta)}` : this.formatVolume(delta);
    this.drawTextWithShadow(ctx, text, unitX + unitWidth / 2, priceToY(lowestPrice) + 14);
  }

  formatVolume(volume) {
    if (volume === undefined || volume === null) return '0';
    volume = maskVolume(volume);
    const absVolume = Math.abs(volume);
    if (absVolume >= 1000000) return (volume / 1000000).toFixed(1) + 'M';
    if (absVolume >= 1000) return (volume / 1000).toFixed(1) + 'K';
    if (absVolume >= 100) return Math.round(volume).toString();
    if (absVolume >= 1) return volume.toFixed(1);
    return volume.toFixed(2);
  }

  drawTextWithShadow(ctx, text, x, y) {
    ctx.save();
    ctx.strokeStyle = this.colors.TEXT_SHADOW;
    ctx.lineWidth = 2;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  renderDeltaMark(ctx, candle, footprint, centerX, priceToY, candleWidth) {
    const buying = footprint.total_delta > 0;
    const size = Math.min(5, Math.max(2.5, candleWidth * 0.5));
    const y = buying ? priceToY(candle.low) + size + 3 : priceToY(candle.high) - size - 3;

    const buyRgb = isNewTheme() ? this._stackedRgb('stackedBuyColor', THEME.fpBuyRgb) : this.config.stackedBuyColor;
    const sellRgb = isNewTheme() ? this._stackedRgb('stackedSellColor', THEME.fpSellRgb) : this.config.stackedSellColor;
    ctx.fillStyle = `rgb(${buying ? buyRgb : sellRgb})`;
    ctx.beginPath();
    ctx.moveTo(centerX, y - size);
    ctx.lineTo(centerX + size, y);
    ctx.lineTo(centerX, y + size);
    ctx.lineTo(centerX - size, y);
    ctx.closePath();
    ctx.fill();
  }

  /** Con velas angostas: líneas de stacked imbalance y marcas de delta contrario a la vela */
  renderImbalanceMarkers(ctx, bounds, visibleCandles, priceToY, candleWidth) {
    const { stackedLineWidth, stackedLineExtend, stackedOpacity } = this.config;
    const stackedBuyColor = isNewTheme() ? this._stackedRgb('stackedBuyColor', THEME.fpBuyRgb) : this.config.stackedBuyColor;
    const stackedSellColor = isNewTheme() ? this._stackedRgb('stackedSellColor', THEME.fpSellRgb) : this.config.stackedSellColor;
    const minZScore = this.config.stackedMinVolumeZScore || 0;
    const extraHalf = (candleWidth * stackedLineExtend - candleWidth) / 2;

    ctx.lineWidth = crispWidth(stackedLineWidth);

    visibleCandles.forEach((candle, i) => {
      const footprint = this.footprintMap.get(candle.timestamp);
      if (!footprint) return;

      const candleX = bounds.x + i * candleWidth;

      if (this.config.showDeltaMarks && this.deltaAgainstCandle(footprint, candle)) {
        this.renderDeltaMark(ctx, candle, footprint, candleX + candleWidth / 2, priceToY, candleWidth);
        const buying = footprint.total_delta > 0;
        const size = Math.min(5, Math.max(2.5, candleWidth * 0.5));
        const markY = buying ? priceToY(candle.low) + size + 3 : priceToY(candle.high) - size - 3;
        this._target('Delta contrario', candle, null, { x: candleX + candleWidth / 2, y: markY, r: 7 }, { mark: true, price: buying ? candle.low : candle.high });
      }

      if (!footprint.stacked_imbalances?.length) return;
      if (minZScore > 0 && (footprint.volume_zscore || 0) < minZScore) return;

      const startX = Math.max(bounds.x, candleX - extraHalf);
      const endX = Math.min(bounds.x + bounds.width, candleX + candleWidth + extraHalf);

      for (const stacked of footprint.stacked_imbalances) {
        const rgb = stacked.direction === 'BUY' ? stackedBuyColor : stackedSellColor;
        ctx.strokeStyle = `rgba(${rgb}, ${stackedOpacity})`;

        const span = this._span(footprint, stacked.levels || []);
        if (span) {
          const kind = stacked.direction === 'BUY' ? 'Stacked de compra' : 'Stacked de venta';
          const geometry = { left: startX, right: endX, top: priceToY(span.high) - 2, bottom: priceToY(span.low) + 2 };
          this._target(kind, candle, span.price, geometry, { low: span.low, high: span.high });
        }

        for (const index of stacked.levels || []) {
          const level = footprint.levels[index];
          if (!level) continue;
          const y = alignY(priceToY(level.price_mid), stackedLineWidth);
          ctx.beginPath();
          ctx.moveTo(startX, y);
          ctx.lineTo(endX, y);
          ctx.stroke();
        }
      }
    });
  }

  // Se dibuja sobre las velas desde MiniChart: no tiene panel propio
  render() {}

  // ==================== API PÚBLICA PARA EL SIDEBAR ====================

  /** Footprint de una vela, usado por FootprintSidebar */
  getFootprintForTimestamp(timestamp) {
    return this.footprintMap.get(timestamp) || null;
  }

  getFootprintsForTimestamps(timestamps) {
    return timestamps
      .map(timestamp => this.getFootprintForTimestamp(timestamp))
      .filter(Boolean);
  }

  getStackedImbalancesForTimestamp(timestamp) {
    return this.getFootprintForTimestamp(timestamp)?.stacked_imbalances || [];
  }
}

export default OrderFlowIndicator;
