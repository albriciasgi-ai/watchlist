import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';

const MINUTES_BY_INTERVAL = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240 };
const MAX_CANDLES_TO_LOAD = 400; // Con más velas en pantalla no se piden footprints
const MAX_FOOTPRINTS_IN_MEMORY = 6000;
const MIN_REQUEST_GAP_MS = 400;
const ERROR_WAIT_MS = 5000;
const STEP_RESET_CHANGE = 0.3; // Si el precio se aleja 30% se elige otro step

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

    this.isLoading = false;
    this.error = null;
    this.nextRequestAt = 0;
    this.retryTimer = null;

    this.config = this.getDefaultConfig();

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
      showFootprint: true,
      showPOC: true,
      showImbalances: true,
      showDelta: true,
      fontSize: 9,
      minCandleWidth: 16, // Desde este ancho el footprint reemplaza la vela
      minCandleWidthFull: 60, // Desde este ancho se muestran cifras y delta
      stackedLineWidth: 2,
      stackedLineExtend: 3,
      stackedBuyColor: '38,166,154',
      stackedSellColor: '239,83,80',
      stackedOpacity: 0.7,
      stackedMinVolumeZScore: 0,
      showDeltaMarks: true,
      deltaMarkMinShare: 0.2 // Parte del volumen de la vela que debe ir contra su color
    };
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
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
    const target = candle.in_progress ? candle.knownUntil : candle.timestamp + this.tfMs;
    const seen = this.footprintMap.get(candle.timestamp)?.knownUntil ?? this.noData.get(candle.timestamp) ?? 0;
    return seen < target;
  }

  _loadVisible(visibleCandles, priceContext) {
    const { knownUntil, requestRedraw } = priceContext;
    if (!knownUntil) return;

    this._syncClock(knownUntil, visibleCandles[visibleCandles.length - 1].close);
    if (visibleCandles.length > MAX_CANDLES_TO_LOAD) return;

    const missing = visibleCandles.filter(candle => this._needsData(candle));
    if (missing.length === 0) return;

    // Al desplazarse se trae una ventana de más; una vela que avanza solo se pide a sí misma
    const pad = missing.length > 4 ? Math.ceil(visibleCandles.length / 2) * this.tfMs : 0;
    const start = missing[0].timestamp - pad;
    const end = missing[missing.length - 1].timestamp + this.tfMs + pad;
    this._request(start, end, knownUntil, requestRedraw);
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
    if (this.stepSize) params.append('step', String(this.stepSize));

    fetch(`${API_BASE_URL}/api/orderflow/historical/${this.symbol}?${params}`)
      .then(response => {
        if (!response.ok) throw new Error(`Error ${response.status}`);
        return response.json();
      })
      .then(data => {
        if (!data.success) throw new Error(data.message || 'Sin respuesta del almacén');
        if (generation === this.generation) this._store(data, start, end);
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

  renderOnChart(ctx, bounds, visibleCandles, priceContext, replacesCandles) {
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
    } else if (!this.isLoading && visibleCandles.length <= MAX_CANDLES_TO_LOAD
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
    const color = candle.close >= candle.open ? this.colors.CANDLE_UP : this.colors.CANDLE_DOWN;

    const openY = priceToY(candle.open);
    const closeY = priceToY(candle.close);
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(1, Math.max(openY, closeY) - bodyTop);

    ctx.strokeStyle = this.colors.CANDLE_WICK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, priceToY(candle.high));
    ctx.lineTo(centerX, priceToY(candle.low));
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
      this.renderVolumeProfile(ctx, footprint, profileX, profileWidth, priceToY, bounds);
    }
    if (this.config.showDelta && fullMode) {
      this.renderDelta(ctx, footprint, unitX, unitWidth, low, priceToY);
    }
  }

  renderJapaneseCandle(ctx, candle, x, width, priceToY, high, low) {
    const centerX = x + width / 2;
    const bodyWidth = Math.max(2, width * 0.6);
    const color = candle.close >= candle.open ? this.colors.CANDLE_UP : this.colors.CANDLE_DOWN;

    const openY = priceToY(candle.open);
    const closeY = priceToY(candle.close);
    const bodyTop = Math.min(openY, closeY);
    const bodyBottom = Math.max(openY, closeY);
    const bodyHeight = Math.max(1, bodyBottom - bodyTop);

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
      ctx.fillStyle = isPOC ? this.colors.PROFILE_POC : this.colors.PROFILE_BAR;
      ctx.fillRect(x, topY, barWidth, Math.max(1, levelHeight - 1));

      if (isPOC && this.config.showPOC) {
        ctx.strokeStyle = this.colors.POC_LINE;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, topY + levelHeight / 2);
        ctx.lineTo(x + barWidth, topY + levelHeight / 2);
        ctx.stroke();
      }
    }
  }

  /** Celdas de venta (izquierda) y compra (derecha) por nivel */
  renderFootprint(ctx, footprint, extraLevels, x, width, priceToY, fullMode, unitX, bounds) {
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
      ctx.fillStyle = this.colors.EMPTY_BG;
      ctx.fillRect(x, y, width, cellHeight);
    }

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const y = priceToY(level.price_max);
      if (isOutside(y)) continue;

      const textY = y + levelHeight / 2;
      const isEmpty = level.total_volume === 0;
      const sellDominates = level.bid_volume > level.ask_volume;
      const buyDominates = level.ask_volume > level.bid_volume;

      ctx.fillStyle = isEmpty ? this.colors.EMPTY_BG : (sellDominates ? this.colors.BID_BG_STRONG : this.colors.BID_BG_WEAK);
      ctx.fillRect(x, y, halfWidth - 0.5, cellHeight);

      ctx.fillStyle = isEmpty ? this.colors.EMPTY_BG : (buyDominates ? this.colors.ASK_BG_STRONG : this.colors.ASK_BG_WEAK);
      ctx.fillRect(x + halfWidth + 0.5, y, halfWidth - 0.5, cellHeight);

      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, width, cellHeight);

      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + halfWidth, y);
      ctx.lineTo(x + halfWidth, y + cellHeight);
      ctx.stroke();

      if (this.config.showPOC && i === pocIndex) {
        ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
        ctx.fillRect(x, textY - 1, width, 2);
      }

      if (this.config.showImbalances && stackedSet.has(i)) {
        const rgb = stackedSet.get(i) === 'BUY' ? this.config.stackedBuyColor : this.config.stackedSellColor;
        const opacity = this.config.stackedOpacity;

        ctx.fillStyle = `rgba(${rgb}, ${opacity * 0.4})`;
        ctx.fillRect(x, y, width, cellHeight);
        ctx.strokeStyle = `rgba(${rgb}, 0.95)`;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, cellHeight);

        // La franja sigue hacia la izquierda, por detrás de la vela
        const extendLeft = x - unitX;
        if (extendLeft > 0) {
          ctx.fillStyle = `rgba(${rgb}, ${opacity * 0.6})`;
          ctx.fillRect(unitX, y, extendLeft, cellHeight);
          ctx.strokeStyle = `rgba(${rgb}, ${opacity * 0.8})`;
          ctx.lineWidth = 1;
          ctx.strokeRect(unitX, y, extendLeft, cellHeight);
        }
      } else if (this.config.showImbalances && imbalanceSet.has(i) && levelHeight >= 6) {
        // En celdas muy bajas el borde taparía el color de la celda
        ctx.strokeStyle = this.colors.IMBALANCE_BORDER;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, cellHeight);
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

    ctx.font = `bold ${this.config.fontSize}px Arial`;
    ctx.fillStyle = delta >= 0 ? this.colors.CANDLE_UP : this.colors.CANDLE_DOWN;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const text = delta >= 0 ? `+${this.formatVolume(delta)}` : this.formatVolume(delta);
    this.drawTextWithShadow(ctx, text, unitX + unitWidth / 2, priceToY(lowestPrice) + 14);
  }

  formatVolume(volume) {
    if (volume === undefined || volume === null) return '0';
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

    ctx.fillStyle = `rgb(${buying ? this.config.stackedBuyColor : this.config.stackedSellColor})`;
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
    const { stackedLineWidth, stackedLineExtend, stackedBuyColor, stackedSellColor, stackedOpacity } = this.config;
    const minZScore = this.config.stackedMinVolumeZScore || 0;
    const extraHalf = (candleWidth * stackedLineExtend - candleWidth) / 2;

    ctx.lineWidth = stackedLineWidth;

    visibleCandles.forEach((candle, i) => {
      const footprint = this.footprintMap.get(candle.timestamp);
      if (!footprint) return;

      const candleX = bounds.x + i * candleWidth;

      if (this.config.showDeltaMarks && this.deltaAgainstCandle(footprint, candle)) {
        this.renderDeltaMark(ctx, candle, footprint, candleX + candleWidth / 2, priceToY, candleWidth);
      }

      if (!footprint.stacked_imbalances?.length) return;
      if (minZScore > 0 && (footprint.volume_zscore || 0) < minZScore) return;

      const startX = Math.max(bounds.x, candleX - extraHalf);
      const endX = Math.min(bounds.x + bounds.width, candleX + candleWidth + extraHalf);

      for (const stacked of footprint.stacked_imbalances) {
        const rgb = stacked.direction === 'BUY' ? stackedBuyColor : stackedSellColor;
        ctx.strokeStyle = `rgba(${rgb}, ${stackedOpacity})`;

        for (const index of stacked.levels || []) {
          const level = footprint.levels[index];
          if (!level) continue;
          const y = priceToY(level.price_mid);
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
