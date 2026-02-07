// ZoneVisualizerIndicator.js
// Visualiza zonas detectadas por el Zone Detector 2.0 backend

import IndicatorBase from "./IndicatorBase";
import { API_BASE_URL } from "../../config.js";

class ZoneVisualizerIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = "Zone Visualizer";
    this.height = 0; // No ocupa espacio (overlay en chart)

    // Zonas a renderizar (combinacion de manuales + realtime)
    this.zones = [];
    this._manualZones = [];   // Zonas de "Detectar zonas" (boton manual)
    this._realtimeZones = []; // Zonas del servicio realtime

    // Metricas por candle para barras horizontales
    this._metricsMap = new Map(); // timestamp -> {primary, ttm_squeeze, bbwp}
    this._activeLayers = {};     // Que capas estan activas en el config
    this._methodLabel = "";      // "CONSOL" o "IN RANGE"
    this._lastMetricsFetch = 0;
    this._metricsFetchInterval = 30000; // Polling cada 30s
    this._isFetchingMetrics = false;
    this.metricsBarHeight = 8;
    this._detectionParams = {};  // Params del ZoneDetectorSettings para enviar al endpoint

    // Configuracion visual
    this.config = {
      showZones: true,
      showLabels: true,
      showScores: true,
      highlightTradeable: true,
      opacity: 0.15,
      borderWidth: 1,
      // Colores por metodo
      colors: {
        pivot_cluster: { fill: 'rgba(74, 111, 165, 0.15)', border: '#4a6fa5' },
        atr_based: { fill: 'rgba(165, 74, 74, 0.15)', border: '#a54a4a' },
        volume_profile: { fill: 'rgba(74, 165, 74, 0.15)', border: '#4aa54a' },
        price_action: { fill: 'rgba(165, 165, 74, 0.15)', border: '#a5a54a' },
        consolidation: { fill: 'rgba(255, 152, 0, 0.20)', border: '#FF9800' }, // Naranja para consolidation
        trading_zones: { fill: 'rgba(100, 100, 255, 0.15)', border: '#6464FF' }, // Azul para trading zones
        // Colores especiales por resultado de trading
        trading_win: { fill: 'rgba(0, 200, 100, 0.25)', border: '#00C864' },
        trading_loss: { fill: 'rgba(255, 50, 50, 0.25)', border: '#FF3232' },
        trading_open: { fill: 'rgba(255, 200, 0, 0.20)', border: '#FFC800' },
        default: { fill: 'rgba(128, 128, 128, 0.15)', border: '#808080' }
      },
      tradeableHighlight: { fill: 'rgba(74, 165, 74, 0.25)', border: '#4aa54a' }
    };

    console.log(`[${this.symbol}] ZoneVisualizerIndicator: Inicializado`);
  }

  /**
   * Combina zonas manuales + realtime, deduplicando por start_timestamp + end_timestamp
   */
  _mergeZones() {
    this._skipLogged = false;
    this._renderLogged = false;
    this._noRenderLogged = false;

    // Manuales tienen prioridad (incluyen volume profile)
    const manualKeys = new Set();
    const merged = [];

    for (const z of this._manualZones) {
      const key = `${z.start_timestamp}_${z.end_timestamp}`;
      manualKeys.add(key);
      merged.push({ ...z, _debugLogged: false, _skippedLogged: false, _priceCheckLogged: false, _yErrorLogged: false, _yRangeLogged: false });
    }

    // Agregar realtime que no esten ya en manuales
    for (const z of this._realtimeZones) {
      const key = `${z.start_timestamp}_${z.end_timestamp}`;
      if (!manualKeys.has(key)) {
        merged.push({ ...z, _source: 'realtime', _debugLogged: false, _skippedLogged: false, _priceCheckLogged: false, _yErrorLogged: false, _yRangeLogged: false });
      }
    }

    this.zones = merged;
  }

  /**
   * Establece zonas de deteccion manual (boton "Detectar zonas")
   * @param {Array} zones - Array de zonas del backend
   */
  setZones(zones) {
    this._manualZones = zones || [];
    this._mergeZones();
    console.log(`[${this.symbol}] ZoneVisualizer: ${this._manualZones.length} zonas manuales (total: ${this.zones.length})`);
  }

  /**
   * Establece zonas del servicio realtime (polling)
   * @param {Array} zones - Array de zonas realtime
   */
  setRealtimeZones(zones) {
    this._realtimeZones = zones || [];
    this._mergeZones();
    console.log(`[${this.symbol}] ZoneVisualizer: ${this._realtimeZones.length} zonas realtime (total: ${this.zones.length})`);
  }

  /**
   * Agrega zonas sin reemplazar las existentes
   * @param {Array} zones - Array de zonas a agregar
   */
  addZones(zones) {
    this._manualZones = [...this._manualZones, ...(zones || [])];
    this._mergeZones();
    console.log(`[${this.symbol}] ZoneVisualizer: ${zones.length} zonas agregadas (total: ${this.zones.length})`);
  }

  /**
   * Limpia todas las zonas (manuales y realtime)
   */
  clearZones() {
    this._manualZones = [];
    this._realtimeZones = [];
    this.zones = [];
    console.log(`[${this.symbol}] ZoneVisualizer: Zonas limpiadas`);
  }

  /**
   * Actualiza configuracion visual
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log(`[${this.symbol}] ZoneVisualizer: Config actualizada`);
  }

  /**
   * Renderiza las zonas en el canvas del chart (metodo standard)
   */
  render(ctx, candles, chartDimensions, transform) {
    // No-op: usamos renderOverlay para overlay en el chart de precios
  }

  /**
   * Renderiza las zonas como overlay en el chart de precios
   * Este metodo es llamado por IndicatorManager.renderOverlays()
   */
  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext = null) {
    // Skip si no hay zonas o está deshabilitado
    if (!this.enabled || !this.config.showZones || this.zones.length === 0) {
      if (!this._skipLogged) {
        console.log(`[${this.symbol}] ZoneVisualizer.renderOverlay SKIP: enabled=${this.enabled}, showZones=${this.config.showZones}, zones=${this.zones.length}`);
        this._skipLogged = true;
      }
      return;
    }

    // Necesitamos priceToY (función) para convertir precios a coordenadas Y
    if (!priceContext || !priceContext.priceToY) {
      console.log(`[${this.symbol}] ZoneVisualizer.renderOverlay SKIP: no priceContext or priceToY`);
      return;
    }

    // 🔍 DEBUG: Log una vez por sesión
    if (!this._renderLogged) {
      console.log(`[${this.symbol}] 🎯 ZoneVisualizer.renderOverlay: Renderizando ${this.zones.length} zonas`);
      console.log(`[${this.symbol}] 🎯 priceContext:`, {
        minPrice: priceContext.minPrice,
        maxPrice: priceContext.maxPrice,
        hasTimeToX: !!priceContext.timeToX
      });
      if (visibleCandles && visibleCandles.length > 0) {
        console.log(`[${this.symbol}] 🎯 visibleCandles range:`, {
          firstTs: visibleCandles[0].timestamp,
          lastTs: visibleCandles[visibleCandles.length - 1].timestamp,
          firstDate: new Date(visibleCandles[0].timestamp).toISOString(),
          lastDate: new Date(visibleCandles[visibleCandles.length - 1].timestamp).toISOString()
        });
      }
      // Log primera zona para comparar
      if (this.zones.length > 0) {
        const z = this.zones[0];
        console.log(`[${this.symbol}] 🎯 Primera zona:`, {
          min_price: z.min_price,
          max_price: z.max_price,
          start_ts: z.start_timestamp,
          end_ts: z.end_timestamp,
          start_date: new Date(z.start_timestamp).toISOString(),
          end_date: new Date(z.end_timestamp).toISOString()
        });
      }
      this._renderLogged = true;
    }

    ctx.save();

    // Renderizar cada zona
    let renderedCount = 0;
    for (const zone of this.zones) {
      const rendered = this._renderZoneOverlay(ctx, zone, visibleCandles, allCandles, bounds, priceContext);
      if (rendered) renderedCount++;
    }

    // Log si no se renderizó ninguna zona
    if (renderedCount === 0 && !this._noRenderLogged) {
      console.warn(`[${this.symbol}] ⚠️ ZoneVisualizer: 0 de ${this.zones.length} zonas renderizadas`);
      this._noRenderLogged = true;
    }

    ctx.restore();
  }

  /**
   * Renderiza una zona individual como overlay
   * Dibuja 2 rectangulos: consolidacion + trade (entry -> TP/SL)
   * @returns {boolean} true si se renderizo, false si se salto
   */
  _renderZoneOverlay(ctx, zone, visibleCandles, allCandles, bounds, priceContext) {
    // No renderizar zonas sin trade (SKIPPED, NO_ENTRY)
    if (zone.trade_result === 'SKIPPED' || zone.trade_result === 'NO_ENTRY') {
      return false;
    }

    const { x: boundsX, y: boundsY, width: boundsWidth, height: boundsHeight } = bounds;
    const { priceToY, timeToX, minPrice, maxPrice } = priceContext;
    // Usar timeline_index del backend (orden cronologico) si existe
    const zoneIndex = zone.timeline_index || (this.zones.indexOf(zone) + 1);

    // --- RECTANGULO 1: Zona de consolidacion ---
    const yZoneTop = priceToY(zone.max_price);
    const yZoneBottom = priceToY(zone.min_price);

    if (yZoneTop === undefined || yZoneBottom === undefined || isNaN(yZoneTop) || isNaN(yZoneBottom)) {
      return false;
    }

    // Calcular X de la consolidacion
    let xZoneStart = boundsX;
    let xZoneEnd = boundsX + boundsWidth;

    if (timeToX && zone.start_timestamp && zone.end_timestamp) {
      const cx1 = timeToX(zone.start_timestamp);
      const cx2 = timeToX(zone.end_timestamp);
      if (cx1 !== null && cx1 !== undefined) xZoneStart = Math.max(boundsX, cx1);
      if (cx2 !== null && cx2 !== undefined) xZoneEnd = Math.min(boundsX + boundsWidth, cx2);
    }

    // Clamp Y a area visible
    const yTop = Math.max(Math.min(yZoneTop, yZoneBottom), boundsY);
    const yBot = Math.min(Math.max(yZoneTop, yZoneBottom), boundsY + boundsHeight);

    if (yTop >= yBot || xZoneStart >= xZoneEnd) {
      return false;
    }

    // Dibujar consolidacion: azul semi-transparente
    ctx.fillStyle = 'rgba(100, 140, 200, 0.12)';
    ctx.fillRect(xZoneStart, yTop, xZoneEnd - xZoneStart, yBot - yTop);

    // Bordes punteados de la consolidacion
    ctx.strokeStyle = 'rgba(100, 140, 200, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(xZoneStart, yTop);
    ctx.lineTo(xZoneEnd, yTop);
    ctx.moveTo(xZoneStart, yBot);
    ctx.lineTo(xZoneEnd, yBot);
    ctx.stroke();
    ctx.setLineDash([]);

    // Lineas verticales de la consolidacion
    ctx.strokeStyle = 'rgba(100, 140, 200, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xZoneStart, yTop);
    ctx.lineTo(xZoneStart, yBot);
    ctx.moveTo(xZoneEnd, yTop);
    ctx.lineTo(xZoneEnd, yBot);
    ctx.stroke();

    // --- RECTANGULO 2: Trade (entry -> TP/SL) ---
    if (zone.entry_price && zone.sl_price && zone.tp_price && zone.entry_timestamp) {
      const isWin = zone.trade_result === 'WIN';
      const isOpen = zone.trade_result === 'OPEN';

      // Colores segun estado
      const tradeColors = isOpen
        ? { fill: 'rgba(255, 180, 0, 0.08)', border: 'rgba(255, 180, 0, 0.4)' }
        : isWin
          ? { fill: 'rgba(0, 180, 80, 0.10)', border: 'rgba(0, 180, 80, 0.4)' }
          : { fill: 'rgba(220, 40, 40, 0.10)', border: 'rgba(220, 40, 40, 0.4)' };

      // X del trade: desde entry hasta cierre (o borde derecho si OPEN)
      let xTradeStart = boundsX;
      let xTradeEnd = boundsX + boundsWidth;

      if (timeToX) {
        const tx1 = timeToX(zone.entry_timestamp);
        if (tx1 !== null && tx1 !== undefined) xTradeStart = Math.max(boundsX, tx1);

        if (!isOpen && zone.trade_close_timestamp) {
          const tx2 = timeToX(zone.trade_close_timestamp);
          if (tx2 !== null && tx2 !== undefined) xTradeEnd = Math.min(boundsX + boundsWidth, tx2);
        }
        // Si OPEN, xTradeEnd queda al borde derecho del chart
      }

      if (xTradeStart < xTradeEnd) {
        // Y del trade: entre SL y TP
        const yEntry = priceToY(zone.entry_price);
        const ySL = priceToY(zone.sl_price);
        const yTP = priceToY(zone.tp_price);

        if (yEntry !== undefined && ySL !== undefined && yTP !== undefined) {
          const yTradeTop = Math.max(Math.min(ySL, yTP), boundsY);
          const yTradeBot = Math.min(Math.max(ySL, yTP), boundsY + boundsHeight);
          const tradeWidth = xTradeEnd - xTradeStart;
          const tradeHeight = yTradeBot - yTradeTop;

          if (tradeHeight > 0 && tradeWidth > 0) {
            // Fill del trade
            ctx.fillStyle = tradeColors.fill;
            ctx.fillRect(xTradeStart, yTradeTop, tradeWidth, tradeHeight);

            // Borde del trade (punteado si OPEN)
            ctx.strokeStyle = tradeColors.border;
            ctx.lineWidth = 1;
            ctx.setLineDash(isOpen ? [4, 4] : []);
            ctx.strokeRect(xTradeStart, yTradeTop, tradeWidth, tradeHeight);
            ctx.setLineDash([]);

            // Linea de ENTRY: blanca punteada
            const yEntryClamp = Math.max(Math.min(yEntry, boundsY + boundsHeight), boundsY);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(xTradeStart, yEntryClamp);
            ctx.lineTo(xTradeEnd, yEntryClamp);
            ctx.stroke();

            // Linea de TP: verde solida
            const yTPClamp = Math.max(Math.min(yTP, boundsY + boundsHeight), boundsY);
            ctx.strokeStyle = 'rgba(0, 200, 80, 0.9)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(xTradeStart, yTPClamp);
            ctx.lineTo(xTradeEnd, yTPClamp);
            ctx.stroke();

            // Linea de SL: roja solida
            const ySLClamp = Math.max(Math.min(ySL, boundsY + boundsHeight), boundsY);
            ctx.strokeStyle = 'rgba(220, 40, 40, 0.9)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(xTradeStart, ySLClamp);
            ctx.lineTo(xTradeEnd, ySLClamp);
            ctx.stroke();

            // Labels de TP y SL al lado derecho
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';

            // Label TP
            ctx.fillStyle = 'rgba(0, 200, 80, 1)';
            ctx.fillText('TP', xTradeEnd - 3, yTPClamp);

            // Label SL
            ctx.fillStyle = 'rgba(220, 40, 40, 1)';
            ctx.fillText('SL', xTradeEnd - 3, ySLClamp);
          }
        }
      }
    }

    // --- LABEL de la zona ---
    if (this.config.showLabels) {
      const isWin = zone.trade_result === 'WIN';
      const isOpen = zone.trade_result === 'OPEN';
      const labelColor = isOpen ? '#FFB300' : (isWin ? '#00C864' : '#FF3232');
      const resultText = isOpen ? 'O' : (isWin ? 'W' : 'L');
      const labelText = `#${zoneIndex} ${resultText}`;

      ctx.font = 'bold 13px Arial';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      const padding = 4;
      const textMetrics = ctx.measureText(labelText);
      const labelWidth = textMetrics.width + padding * 2;
      const labelHeight = 19;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.fillRect(xZoneStart + 2, yTop + 2, labelWidth, labelHeight);

      ctx.fillStyle = labelColor;
      ctx.fillText(labelText, xZoneStart + 2 + padding, yTop + 5);
    }

    return true;
  }

  /**
   * Retorna las zonas para uso externo
   */
  getZones() {
    return this.zones;
  }

  /**
   * Retorna zonas que contienen un precio especifico
   */
  getZonesAtPrice(price) {
    return this.zones.filter(z =>
      price >= z.min_price && price <= z.max_price
    );
  }

  /**
   * Retorna zonas activas (no han tenido breakout)
   */
  getActiveZones() {
    return this.zones.filter(z => !z.breakout);
  }

  /**
   * Retorna las mejores zonas por score
   */
  getTopZones(count = 5) {
    return [...this.zones]
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, count);
  }

  /**
   * No necesita fetch de datos - las zonas vienen del ZoneDetectorTester
   */
  async fetchData() {
    // No-op: las zonas se establecen via setZones()
    return true;
  }

  /**
   * Metodo analyze para compatibilidad con IndicatorManager
   */
  analyze(candles) {
    // No-op: las zonas ya vienen calculadas del backend
    return this.zones;
  }

  // ==========================================================
  // Barras horizontales de metricas (similar a VWAP volatility bars)
  // ==========================================================

  /**
   * Establece los parametros de deteccion (desde ZoneDetectorSettings)
   * para que fetchMetrics los envie al endpoint.
   */
  setDetectionParams(params) {
    this._detectionParams = params || {};
  }

  /**
   * Obtiene metricas por candle del backend (primary, TTM, BBWP)
   * Envia los parametros de deteccion para que el backend adapte la banda primaria.
   */
  async fetchMetrics() {
    if (this._isFetchingMetrics) return;
    this._isFetchingMetrics = true;

    try {
      const p = this._detectionParams || {};
      const params = new URLSearchParams({
        interval: this.interval,
        days: this.days,
        detection_method: p.detection_method || 'trading_zones',
        consol_min_bars: p.consol_min_bars || 8,
        consol_atr_ratio: p.consol_atr_ratio || 0.6,
        consol_max_range_pct: p.consol_max_range_pct || 2.0,
        consol_body_ratio: p.consol_body_ratio || 0.5,
        atr_dyn_period: p.atr_dyn_period || 200,
        atr_dyn_ma_period: p.atr_dyn_ma_period || 20,
        atr_dyn_multiplier: p.atr_dyn_multiplier || 1.0,
        use_ttm_prefilter: p.use_ttm_prefilter || false,
        use_bbwp_scoring: p.use_bbwp_scoring || false,
        atr_band_ma_period: p.atr_band_ma_period || 20,
        ttm_atr_length: p.ttm_atr_length || 20,
        ttm_kc_multiplier: p.ttm_kc_multiplier || 1.5,
        bbwp_lookback: p.bbwp_lookback || 252,
        bbwp_squeeze_threshold: p.bbwp_squeeze_threshold || 20,
      });
      const url = `${API_BASE_URL}/api/zones/realtime/metrics/${this.symbol}?${params}`;
      const res = await fetch(url);
      if (!res.ok) return;

      const data = await res.json();
      if (!data.success || !data.timestamps) return;

      // Construir mapa por timestamp
      this._metricsMap.clear();
      const ts = data.timestamps;
      for (let i = 0; i < ts.length; i++) {
        this._metricsMap.set(ts[i], {
          primary: data.primary ? data.primary[i] || false : false,
          ttm_squeeze: data.ttm_squeeze ? data.ttm_squeeze[i] || false : false,
          bbwp: data.bbwp ? data.bbwp[i] || false : false,
        });
      }
      this._activeLayers = data.active_layers || {};
      this._methodLabel = data.method_label || '';
      this._lastMetricsFetch = Date.now();
    } catch (err) {
      // Silencioso - el servicio puede no estar corriendo
    } finally {
      this._isFetchingMetrics = false;
    }
  }

  /**
   * Retorna cuantas barras activas hay (para calcular altura total)
   */
  getActiveMetricsBarCount() {
    let count = 0;
    const l = this._activeLayers;
    if (l.primary) count++;
    if (l.ttm_squeeze) count++;
    if (l.bbwp) count++;
    return count;
  }

  /**
   * Retorna la altura total que ocupan las barras de metricas
   */
  getMetricsBarsHeight() {
    const count = this.getActiveMetricsBarCount();
    if (count === 0) return 0;
    const barGap = 2;
    return (this.metricsBarHeight * count) + (barGap * (count - 1));
  }

  /**
   * Renderiza las barras horizontales de metricas debajo del VWAP.
   * Patron identico a VWAPIndicator.renderVolatilityBars().
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Posicion X inicial (marginLeft)
   * @param {number} startY - Posicion Y donde comienzan las barras
   * @param {number} width - Ancho disponible
   * @param {number} candleWidth - Ancho de cada vela
   * @param {Array} visibleCandles
   * @returns {number} Altura total ocupada
   */
  renderMetricsBars(ctx, x, startY, width, candleWidth, visibleCandles) {
    if (!visibleCandles || visibleCandles.length === 0) return 0;
    if (this._metricsMap.size === 0) return 0;

    const barHeight = this.metricsBarHeight;
    const barGap = 2;
    const layers = this._activeLayers;

    let activeCount = 0;
    const layerOrder = [];
    // Orden: banda primaria (adapta label segun metodo), luego capas opcionales
    const primaryLabel = this._methodLabel || 'ZONE';
    if (layers.primary) { layerOrder.push({ key: 'primary', label: primaryLabel }); activeCount++; }
    if (layers.ttm_squeeze) { layerOrder.push({ key: 'ttm_squeeze', label: 'TTM' }); activeCount++; }
    if (layers.bbwp) { layerOrder.push({ key: 'bbwp', label: 'BBWP' }); activeCount++; }

    if (activeCount === 0) return 0;

    let currentY = startY;

    for (const layer of layerOrder) {
      this._drawSingleMetricsBar(ctx, visibleCandles, x, currentY, width, candleWidth, barHeight, layer.key, layer.label);
      currentY += barHeight + barGap;
    }

    return (barHeight * activeCount) + (barGap * (activeCount - 1));
  }

  /**
   * Dibuja una barra horizontal para una metrica.
   * Azul = condicion cumplida, gris = no cumplida.
   */
  _drawSingleMetricsBar(ctx, visibleCandles, x, barY, width, candleWidth, barHeight, metricKey, label) {
    const passColor = 'rgba(30, 136, 229, 0.85)';   // Azul cuando pasa
    const failColor = 'rgba(128, 128, 128, 0.25)';   // Gris cuando no pasa

    visibleCandles.forEach((candle, i) => {
      const metrics = this._metricsMap.get(candle.timestamp);
      const candleX = x + (i * candleWidth);

      const pass = metrics ? metrics[metricKey] : false;
      ctx.fillStyle = pass ? passColor : failColor;
      ctx.fillRect(candleX, barY, candleWidth, barHeight);

      // Separador vertical entre velas
      if (i > 0) {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(candleX, barY);
        ctx.lineTo(candleX, barY + barHeight);
        ctx.stroke();
      }
    });

    // Label a la izquierda
    const fontSize = Math.min(12, Math.max(8, Math.floor(barHeight * 0.6)));
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 2;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textBaseline = 'middle';

    const labelX = x - 35;
    const labelY = barY + (barHeight / 2);

    ctx.strokeText(label, labelX, labelY);
    ctx.fillText(label, labelX, labelY);
  }
}

export default ZoneVisualizerIndicator;
