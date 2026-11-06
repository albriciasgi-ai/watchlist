import IndicatorBase from './IndicatorBase.js';
import { ResponseSeries, defaultResponseConfig } from './responseBalance.js';

const SETTINGS_KEY = 'response_balance_settings_';
const PRESSURE_LIMIT = 2; // El panel llega hasta cuatro veces de ventaja
const MIN_MARK_WIDTH = 2; // Con velas más angostas las marcas taparían el precio
const BUY_COLOR = '#26A69A';
const SELL_COLOR = '#EF5350';
const SIGNAL_COLOR = '#F59E0B';

// Cambiar estos parámetros obliga a calcular de nuevo. Las marcas solo cambian el dibujo.
const SERIES_KEYS = ['legAtr', 'window', 'top', 'dominance', 'balance', 'adjustHour'];

/** Parámetros guardados de un símbolo; sin almacenamiento disponible quedan los de fábrica */
export function loadResponseVolumeSettings(symbol) {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY + symbol)) || {};
  } catch {
    return {};
  }
}

export function saveResponseVolumeSettings(symbol, settings) {
  try {
    localStorage.setItem(SETTINGS_KEY + symbol, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento los parámetros siguen vigentes hasta recargar
  }
}

/** Desbalance entre las velas principales de la tendencia y las de la respuesta */
class ResponseVolumeIndicator extends IndicatorBase {
  constructor(symbol, interval, days) {
    super(symbol, interval, days);
    this.name = 'Volumen de Respuesta';
    this.height = 90;
    this.enabled = false;
    this.config = { ...defaultResponseConfig(), ...loadResponseVolumeSettings(symbol) };
    this.series = new ResponseSeries(this.config);
  }

  async fetchData() {
    return true;
  }

  updateConfig(config) {
    const changed = SERIES_KEYS.some(key => key in config && config[key] !== this.config[key]);
    this.config = { ...this.config, ...config };
    this.series.config = this.config;
    if (changed) this.series.reset();
  }

  // Los paneles no reciben las velas conocidas: la serie se actualiza aquí, en cada dibujo del precio
  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext = null) {
    this.series.update(priceContext?.knownCandles || allCandles);

    const { showArrows, showSignals } = this.config;
    if ((!showArrows && !showSignals) || !visibleCandles?.length || !priceContext?.priceToY || !priceContext.timeToX) return;

    const barWidth = bounds.width / visibleCandles.length;
    if (barWidth < MIN_MARK_WIDTH) return;
    const size = Math.max(3, Math.min(7, barWidth * 0.5));

    for (const candle of visibleCandles) {
      const index = this.series.indexOf(candle.timestamp);
      if (index < 0) continue;

      const x = priceContext.timeToX(candle.timestamp);
      if (x === null) continue;

      const principal = showArrows && this.series.isPrincipal(index);
      const signal = showSignals && this.series.signal[index];
      if (!principal && !signal) continue;

      const buying = this.series.side[index] > 0;
      if (principal) {
        const tip = priceContext.priceToY(buying ? candle.low : candle.high) + (buying ? 4 : -4);
        ctx.fillStyle = buying ? BUY_COLOR : SELL_COLOR;
        ctx.beginPath();
        ctx.moveTo(x, tip);
        ctx.lineTo(x - size, tip + (buying ? size * 1.6 : -size * 1.6));
        ctx.lineTo(x + size, tip + (buying ? size * 1.6 : -size * 1.6));
        ctx.closePath();
        ctx.fill();
      }

      if (signal) {
        // Va del lado del extremo del tramo. Si ahí hay una flecha, queda más allá de ella
        const above = this.series.direction[index] === 1;
        const clear = principal && above !== buying ? size * 1.6 + 6 : 4;
        const y = priceContext.priceToY(above ? candle.high : candle.low) + (above ? -clear - size : clear + size);
        this.drawDiamond(ctx, x, y, size);
      }
    }
  }

  drawDiamond(ctx, x, y, size) {
    ctx.fillStyle = SIGNAL_COLOR;
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    ctx.fill();
  }

  /** Texto de la última vela cerrada a la vista */
  reading(index) {
    const balance = this.series.balance[index];
    const leg = this.series.direction[index] === 1 ? 'Tramo alcista' : 'Tramo bajista';
    const state = balance >= this.config.dominance ? 'domina la tendencia' : balance <= this.config.balance ? 'equilibrio' : 'la respuesta se acerca';
    return `${leg} · tendencia / respuesta ${balance.toFixed(2)} · ${state}`;
  }

  render(ctx, bounds, visibleCandles) {
    if (!this.enabled || !visibleCandles?.length) return;

    const { x, y, width, height } = bounds;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#DDE2E7';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.stroke();

    const top = y + 20;
    const half = (height - 24) / 2;
    const zero = top + half;
    const scale = half / PRESSURE_LIMIT;
    const barWidth = width / visibleCandles.length;
    const dominance = Math.log2(this.config.dominance);

    ctx.strokeStyle = '#E5E9ED';
    ctx.setLineDash([3, 3]);
    for (const level of [dominance, -dominance]) {
      const lineY = zero - Math.max(-PRESSURE_LIMIT, Math.min(PRESSURE_LIMIT, level)) * scale;
      ctx.beginPath();
      ctx.moveTo(x, lineY);
      ctx.lineTo(x + width, lineY);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = '#B0BEC5';
    ctx.beginPath();
    ctx.moveTo(x, zero);
    ctx.lineTo(x + width, zero);
    ctx.stroke();

    let lastIndex = -1;
    visibleCandles.forEach((candle, i) => {
      const index = this.series.indexOf(candle.timestamp);
      if (index < 0) return;
      lastIndex = index;

      const pressure = this.series.pressure(index);
      const shown = Math.max(-PRESSURE_LIMIT, Math.min(PRESSURE_LIMIT, pressure)) * scale;
      ctx.globalAlpha = Math.abs(pressure) >= dominance ? 1 : 0.45;
      ctx.fillStyle = pressure >= 0 ? BUY_COLOR : SELL_COLOR;
      ctx.fillRect(x + i * barWidth + barWidth * 0.1, shown >= 0 ? zero - shown : zero, Math.max(barWidth * 0.8, 0.5), Math.abs(shown));
      ctx.globalAlpha = 1;

      if (this.config.showSignals && this.series.signal[index]) {
        this.drawDiamond(ctx, x + i * barWidth + barWidth / 2, zero, 3);
      }
    });

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#666';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.fillText('Volumen de Respuesta', x + 5, y + 15);

    if (lastIndex >= 0) {
      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = '#888';
      ctx.fillText(this.reading(lastIndex), x + 140, y + 15);
    }
  }
}

export default ResponseVolumeIndicator;
