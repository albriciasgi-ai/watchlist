// ZoneVisualizerIndicator.js
// Visualiza zonas detectadas por el Zone Detector 2.0 backend

import IndicatorBase from "./IndicatorBase";

class ZoneVisualizerIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = "Zone Visualizer";
    this.height = 0; // No ocupa espacio (overlay en chart)

    // Zonas a renderizar
    this.zones = [];

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
   * Establece las zonas a visualizar
   * @param {Array} zones - Array de zonas del backend
   */
  setZones(zones) {
    // Limpiar flags de debug de zonas anteriores y del indicador
    this._skipLogged = false;
    this._renderLogged = false;
    this._noRenderLogged = false;

    this.zones = (zones || []).map(z => ({
      ...z,
      _debugLogged: false,
      _skippedLogged: false,
      _priceCheckLogged: false,
      _yErrorLogged: false,
      _yRangeLogged: false
    }));
    console.log(`[${this.symbol}] ZoneVisualizer: ${this.zones.length} zonas cargadas`);
  }

  /**
   * Agrega zonas sin reemplazar las existentes
   * @param {Array} zones - Array de zonas a agregar
   */
  addZones(zones) {
    this.zones = [...this.zones, ...(zones || [])];
    console.log(`[${this.symbol}] ZoneVisualizer: ${zones.length} zonas agregadas (total: ${this.zones.length})`);
  }

  /**
   * Limpia todas las zonas
   */
  clearZones() {
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
    if (zone.entry_price && zone.sl_price && zone.tp_price && zone.entry_timestamp && zone.trade_close_timestamp) {
      const isWin = zone.trade_result === 'WIN';

      // X del trade: desde entry hasta cierre
      let xTradeStart = boundsX;
      let xTradeEnd = boundsX + boundsWidth;

      if (timeToX) {
        const tx1 = timeToX(zone.entry_timestamp);
        const tx2 = timeToX(zone.trade_close_timestamp);
        if (tx1 !== null && tx1 !== undefined) xTradeStart = Math.max(boundsX, tx1);
        if (tx2 !== null && tx2 !== undefined) xTradeEnd = Math.min(boundsX + boundsWidth, tx2);
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
            // Fill del trade: verde si WIN, rojo si LOSS, semi-transparente
            ctx.fillStyle = isWin
              ? 'rgba(0, 180, 80, 0.10)'
              : 'rgba(220, 40, 40, 0.10)';
            ctx.fillRect(xTradeStart, yTradeTop, tradeWidth, tradeHeight);

            // Borde del trade
            ctx.strokeStyle = isWin ? 'rgba(0, 180, 80, 0.4)' : 'rgba(220, 40, 40, 0.4)';
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
            ctx.strokeRect(xTradeStart, yTradeTop, tradeWidth, tradeHeight);

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
      const labelColor = isWin ? '#00C864' : '#FF3232';
      const resultText = isWin ? 'W' : 'L';
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
}

export default ZoneVisualizerIndicator;
