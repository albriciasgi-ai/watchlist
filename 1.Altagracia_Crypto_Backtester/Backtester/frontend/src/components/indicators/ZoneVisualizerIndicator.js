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
    this.zones = zones || [];
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
      return;
    }

    // Necesitamos priceToY (función) para convertir precios a coordenadas Y
    if (!priceContext || !priceContext.priceToY) {
      return;
    }

    ctx.save();

    // Renderizar cada zona
    for (const zone of this.zones) {
      this._renderZoneOverlay(ctx, zone, visibleCandles, allCandles, bounds, priceContext);
    }

    ctx.restore();
  }

  /**
   * Renderiza una zona individual como overlay
   */
  _renderZoneOverlay(ctx, zone, visibleCandles, allCandles, bounds, priceContext) {
    const { x: boundsX, y: boundsY, width: boundsWidth, height: boundsHeight } = bounds;
    const { priceToY } = priceContext;

    // Obtener coordenadas Y para los precios usando priceToY (funcion)
    const y1 = priceToY(zone.max_price);
    const y2 = priceToY(zone.min_price);

    if (y1 === undefined || y2 === undefined || isNaN(y1) || isNaN(y2)) {
      return;
    }

    // Asegurar que las coordenadas Y estan dentro del area visible
    const yTop = Math.max(Math.min(y1, y2), boundsY);
    const yBottom = Math.min(Math.max(y1, y2), boundsY + boundsHeight);

    if (yTop >= yBottom) {
      return; // Zona fuera del area visible
    }

    // Para simplificar, las zonas se extienden de borde a borde del chart
    // Esto es similar a como funcionan otros indicadores de S/R
    const x1 = boundsX;
    const x2 = boundsX + boundsWidth;

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

    // Border
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = this.config.borderWidth;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x1, yTop, width, height);
    ctx.setLineDash([]);

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

    // Labels
    if (this.config.showLabels) {
      this._renderLabelOverlay(ctx, zone, x1, yTop, width, height, borderColor);
    }
  }

  /**
   * Renderiza el label de la zona (overlay version)
   */
  _renderLabelOverlay(ctx, zone, x, y, width, height, color) {
    ctx.font = '10px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Construir texto del label
    let labelText = zone.method.replace('_', ' ').toUpperCase();

    if (this.config.showScores && zone.score !== undefined) {
      labelText += ` (${zone.score.toFixed(0)})`;
    }

    if (zone.tradeable) {
      labelText += ' [T]';
    }

    // Background del label
    const padding = 3;
    const textMetrics = ctx.measureText(labelText);
    const labelWidth = textMetrics.width + padding * 2;
    const labelHeight = 14;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(x + 2, y + 2, labelWidth, labelHeight);

    // Texto
    ctx.fillStyle = color;
    ctx.fillText(labelText, x + 2 + padding, y + 4);

    // Info adicional (toques, duracion)
    if (zone.total_touches !== undefined && height > 30) {
      const infoText = `${zone.total_touches} toques | ${zone.duration_hours?.toFixed(0) || '?'}h`;
      ctx.fillStyle = 'rgba(200, 200, 200, 0.8)';
      ctx.font = '9px Arial';
      ctx.fillText(infoText, x + 2, y + height - 14);
    }
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
