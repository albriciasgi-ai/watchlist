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
   * @returns {boolean} true si se renderizó, false si se saltó
   */
  _renderZoneOverlay(ctx, zone, visibleCandles, allCandles, bounds, priceContext) {
    const { x: boundsX, y: boundsY, width: boundsWidth, height: boundsHeight } = bounds;
    const { priceToY, timeToX, minPrice, maxPrice } = priceContext;

    // 🔍 DEBUG: Log una vez por zona para diagnóstico
    const zoneIndex = this.zones.indexOf(zone) + 1;
    if (!zone._priceCheckLogged) {
      const inPriceRange = zone.min_price <= maxPrice && zone.max_price >= minPrice;
      console.log(`[ZoneVisualizer] Zona #${zoneIndex} precio check:`, {
        zone_min: zone.min_price?.toFixed(2),
        zone_max: zone.max_price?.toFixed(2),
        chart_min: minPrice?.toFixed(2),
        chart_max: maxPrice?.toFixed(2),
        inPriceRange
      });
      zone._priceCheckLogged = true;
    }

    // Obtener coordenadas Y para los precios usando priceToY (funcion)
    const y1 = priceToY(zone.max_price);
    const y2 = priceToY(zone.min_price);

    if (y1 === undefined || y2 === undefined || isNaN(y1) || isNaN(y2)) {
      if (!zone._yErrorLogged) {
        console.warn(`[ZoneVisualizer] Zona #${zoneIndex} SKIP: y1=${y1}, y2=${y2} (undefined o NaN)`);
        zone._yErrorLogged = true;
      }
      return false;
    }

    // Asegurar que las coordenadas Y estan dentro del area visible
    const yTop = Math.max(Math.min(y1, y2), boundsY);
    const yBottom = Math.min(Math.max(y1, y2), boundsY + boundsHeight);

    if (yTop >= yBottom) {
      if (!zone._yRangeLogged) {
        console.log(`[ZoneVisualizer] Zona #${zoneIndex} SKIP: yTop(${yTop.toFixed(0)}) >= yBottom(${yBottom.toFixed(0)}) - fuera de rango Y visible`);
        zone._yRangeLogged = true;
      }
      return false; // Zona fuera del area visible
    }

    // 🎯 NUEVO: Calcular límites X usando timestamps de la zona
    let x1 = boundsX;
    let x2 = boundsX + boundsWidth;
    let hasTemporalLimits = false;

    if (timeToX && zone.start_timestamp && zone.end_timestamp) {
      const calcX1 = timeToX(zone.start_timestamp);
      const calcX2 = timeToX(zone.end_timestamp);

      // 🔍 DEBUG: Log de conversión de timestamps (solo primera vez por zona)
      if (!zone._debugLogged) {
        const zoneIndex = this.zones.indexOf(zone) + 1;
        console.log(`[ZoneVisualizer] Zona #${zoneIndex}:`, {
          start_ts: zone.start_timestamp,
          end_ts: zone.end_timestamp,
          calcX1,
          calcX2,
          boundsX,
          boundsWidth,
          isStartVisible: calcX1 !== null && calcX1 >= boundsX && calcX1 <= boundsX + boundsWidth,
          isEndVisible: calcX2 !== null && calcX2 >= boundsX && calcX2 <= boundsX + boundsWidth
        });
        zone._debugLogged = true;
      }

      // Solo usar límites calculados si están en rango visible
      if (calcX1 !== null && calcX1 !== undefined) {
        x1 = Math.max(boundsX, calcX1);
        hasTemporalLimits = true;
      }
      if (calcX2 !== null && calcX2 !== undefined) {
        x2 = Math.min(boundsX + boundsWidth, calcX2);
        hasTemporalLimits = true;
      }
    }

    // Si x1 >= x2, la zona está fuera de la vista
    if (x1 >= x2) {
      // 🔍 DEBUG: Log cuando la zona se descarta por estar fuera de vista
      if (!zone._skippedLogged) {
        console.log(`[ZoneVisualizer] ⚠️ Zona #${zoneIndex} descartada - x1(${x1.toFixed(0)}) >= x2(${x2.toFixed(0)})`);
        zone._skippedLogged = true;
      }
      return false;
    }

    // Obtener colores
    const colors = this.config.colors[zone.method] || this.config.colors.default;
    let fillColor = colors.fill;
    let borderColor = colors.border;

    // Highlight para zonas tradeables
    if (this.config.highlightTradeable && zone.tradeable) {
      fillColor = this.config.tradeableHighlight.fill;
      borderColor = this.config.tradeableHighlight.border;
    }

    // Dibujar rectangulo de la zona
    const width = x2 - x1;
    const height = yBottom - yTop;

    // Fill
    ctx.fillStyle = fillColor;
    ctx.fillRect(x1, yTop, width, height);

    // Border (líneas horizontales punteadas)
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = this.config.borderWidth;
    ctx.setLineDash([4, 4]);

    // Solo dibujar borde horizontal superior e inferior
    ctx.beginPath();
    ctx.moveTo(x1, yTop);
    ctx.lineTo(x2, yTop);
    ctx.moveTo(x1, yBottom);
    ctx.lineTo(x2, yBottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // 🎯 NUEVO: Líneas verticales sólidas en los límites temporales
    if (hasTemporalLimits) {
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);  // Línea sólida

      // Línea izquierda (inicio de zona)
      if (x1 > boundsX) {
        ctx.beginPath();
        ctx.moveTo(x1, yTop);
        ctx.lineTo(x1, yBottom);
        ctx.stroke();
      }

      // Línea derecha (fin de zona)
      if (x2 < boundsX + boundsWidth) {
        ctx.beginPath();
        ctx.moveTo(x2, yTop);
        ctx.lineTo(x2, yBottom);
        ctx.stroke();
      }
    }

    // Lineas de soporte y resistencia mas marcadas
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;

    // Linea de resistencia (superior)
    ctx.beginPath();
    ctx.moveTo(x1, yTop);
    ctx.lineTo(x2, yTop);
    ctx.stroke();

    // Linea de soporte (inferior)
    ctx.beginPath();
    ctx.moveTo(x1, yBottom);
    ctx.lineTo(x2, yBottom);
    ctx.stroke();

    // Labels con numeración
    if (this.config.showLabels) {
      this._renderLabelOverlay(ctx, zone, x1, yTop, width, height, borderColor, zoneIndex);
    }

    return true; // Zona renderizada exitosamente
  }

  /**
   * Renderiza el label de la zona (overlay version)
   * @param {number} zoneIndex - Número de la zona (1-based)
   */
  _renderLabelOverlay(ctx, zone, x, y, width, height, color, zoneIndex = null) {
    // 🎯 SIMPLIFICADO: Solo mostrar el número de zona en grande
    if (zoneIndex === null) return;

    const labelText = `#${zoneIndex}`;

    // Fuente grande y bold
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Background del label
    const padding = 5;
    const textMetrics = ctx.measureText(labelText);
    const labelWidth = textMetrics.width + padding * 2;
    const labelHeight = 22;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(x + 3, y + 3, labelWidth, labelHeight);

    // Texto del número
    ctx.fillStyle = color;
    ctx.fillText(labelText, x + 3 + padding, y + 6);
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
