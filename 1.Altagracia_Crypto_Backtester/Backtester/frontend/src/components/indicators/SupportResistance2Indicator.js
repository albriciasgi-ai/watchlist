// src/components/indicators/SupportResistance2Indicator.js
// S&R v2: mapa de los swings que el precio no ha superado. La detección está en swingLevels.js

import { priceLevels } from './analysisLevels.js';
import { alignY, crispWidth } from '../chartPixels.js';
import { chartInk } from '../uiTheme.js'; // Con Oscuro, el texto de las etiquetas se aclara para leerse
import IndicatorBase from "./IndicatorBase";
import { DEFAULT_LEVEL_CONFIG, LevelBook, cleanLevelConfig } from './swingLevels.js';

import { priceLabel } from '../backtesting/blindClock.js';
const SHOW_KEYS = ['showResistances', 'showSupports', 'showLabels'];

/** Lo que quien opera guardó en el modal. Vale para todos los marcos del símbolo */
export const configStorageKey = (symbol) => `support_resistance_2_config_${symbol}`;

function savedConfig(symbol) {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(configStorageKey(symbol))) || {};
  } catch {
    return {};
  }
}

class SupportResistance2Indicator extends IndicatorBase {
  constructor(symbol, interval, days = 60) {
    super(symbol, interval, days);
    this.name = "S&R v2";
    this.height = 0; // No ocupa espacio propio, se dibuja sobre el chart
    this.days = days;

    Object.assign(this, DEFAULT_LEVEL_CONFIG);

    this.showResistances = true;
    this.showSupports = true;
    this.showLabels = true;
    this.lineWidth = 2;

    this.resistances = [];
    this.supports = [];
    this.currentPrice = 0;

    this._knownCandles = null; // Para que el modal muestre el efecto de un cambio antes de aplicarlo
    this._book = null;

    this.updateConfig(savedConfig(symbol));
  }

  _levelConfig() {
    return Object.fromEntries(Object.keys(DEFAULT_LEVEL_CONFIG).map(key => [key, this[key]]));
  }

  calculateFromCandles(candles) {
    this._knownCandles = candles;
    this._book ??= new LevelBook(this._levelConfig());
    this._book.advance(candles);
    const { resistances, supports, price } = this._book.publish(candles);
    this.resistances = resistances;
    this.supports = supports;
    this.currentPrice = price;
  }

  /** Qué saldría con otros parámetros, sin cambiar lo dibujado */
  preview(config) {
    if (!this._knownCandles) return null;
    const book = new LevelBook({ ...this._levelConfig(), ...cleanLevelConfig(config) });
    book.advance(this._knownCandles);
    return book.publish(this._knownCandles);
  }

  _candlesToUse(visibleCandles, allCandles, priceContext) {
    if (priceContext?.knownCandles) return priceContext.knownCandles;
    const lastVisible = visibleCandles?.[visibleCandles.length - 1]?.timestamp;
    return lastVisible ? allCandles.filter(c => c.timestamp <= lastVisible) : allCandles;
  }

  // ==================== Renderizado ====================

  selectableLevels() {
    return [
      ...priceLevels(this.showResistances ? this.resistances : [], 'S&R v2', 'Resistencia'),
      ...priceLevels(this.showSupports ? this.supports : [], 'S&R v2', 'Soporte')
    ];
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled || !ctx) return;

    if (allCandles?.length > 0) this.calculateFromCandles(this._candlesToUse(visibleCandles, allCandles, priceContext));

    ctx.save();
    if (this.showResistances) {
      this.resistances.forEach((level, idx) => this._drawLevel(ctx, level, 'resistance', bounds, priceContext, idx));
    }
    if (this.showSupports) {
      this.supports.forEach((level, idx) => this._drawLevel(ctx, level, 'support', bounds, priceContext, idx));
    }
    ctx.restore();
  }

  _drawLevel(ctx, level, type, bounds, priceContext, index) {
    const { priceToY } = priceContext;
    const { width, height } = bounds;

    const y = priceToY(level.price);
    if (y < bounds.y || y > bounds.y + height) return;

    // Colores base - FIJOS Y VISIBLES
    const isResistance = type === 'resistance';
    const baseColor = isResistance ? "#FF0000" : "#00FF00"; // Rojo y verde puros

    // Estilo según status - SIEMPRE VISIBLE
    let alpha = 1.0; // Alpha máximo
    let lineStyle = [];
    let lineWidth = 3; // Línea gruesa

    if (level.status === 'broken') {
      alpha = 0.6;
      lineStyle = [8, 4]; // Punteado
      lineWidth = 2;
    }

    const strokeColor = this._hexToRgba(baseColor, alpha);

    // Dibujar línea
    // 🔧 FIX: Usar bounds.x como inicio y bounds.x + width como final
    const startX = bounds.x || 0;
    const endX = startX + width;

    ctx.beginPath();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = crispWidth(lineWidth);
    ctx.setLineDash(lineStyle);
    ctx.moveTo(startX, alignY(y, lineWidth));
    ctx.lineTo(endX, alignY(y, lineWidth));
    ctx.stroke();
    ctx.setLineDash([]);

    // Dibujar etiqueta (lado izquierdo, sin fondo)
    if (this.showLabels) {
      const labelText = `${isResistance ? 'R' : 'S'}${index + 1}: ${priceLabel(level.price)} (${level.touches}t, ${level.strength.toFixed(1)}★, z ${level.avgVolumeZScore.toFixed(1)})`;
      const labelX = startX + 5;
      const labelY = y - 3;

      ctx.font = '10px Arial';
      ctx.fillStyle = this._hexToRgba(chartInk(baseColor), level.status === 'broken' ? 0.6 : 1);
      ctx.textAlign = 'left';
      ctx.fillText(labelText, labelX, labelY);
    }
  }

  _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // ==================== Configuración ====================

  updateConfig(config) {
    Object.assign(this, cleanLevelConfig(config));
    SHOW_KEYS.forEach(key => {
      if (typeof config[key] === 'boolean') this[key] = config[key];
    });
    this._book = null;
  }

  /** Lo que quedó aplicado, para guardarlo y llevarlo a los demás marcos */
  currentConfig() {
    return { ...this._levelConfig(), ...Object.fromEntries(SHOW_KEYS.map(key => [key, this[key]])) };
  }

  clearData() {
    this.resistances = [];
    this.supports = [];
    this.currentPrice = 0;
    this._knownCandles = null;
    this._book = null;
  }

  render(ctx, bounds, visibleCandles) {
    // No renderiza en panel - se dibuja sobre el chart
  }

  getHeight() {
    return 0;
  }
}

export default SupportResistance2Indicator;
