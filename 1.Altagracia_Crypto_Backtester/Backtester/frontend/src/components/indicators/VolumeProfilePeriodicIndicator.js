import { profileLevels } from './analysisLevels.js';
import { alignX, alignY, crispWidth } from '../chartPixels.js';
import IndicatorBase from './IndicatorBase.js';
import { candlesBetween, sessionLength, sessionStart } from './sessionProfile.js';

const SETTINGS_KEY = 'vp_periodic_settings_';

/** Parámetros guardados de un símbolo; sin almacenamiento disponible quedan los de fábrica */
export function loadVPPeriodicSettings(symbol) {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY + symbol)) || {};
  } catch {
    return {};
  }
}

export function saveVPPeriodicSettings(symbol, settings) {
  try {
    localStorage.setItem(SETTINGS_KEY + symbol, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento los parámetros siguen vigentes hasta recargar
  }
}

export function defaultVPPeriodicConfig() {
  return {
    periodHours: 24,
    rows: 50,
    valueAreaPercent: 70,
    histogramWidthPercent: 30, // Parte del ancho de la sesión que ocupa el perfil
    showPOC: true,
    showValueArea: true,
    showLabels: true,
    baseColor: '#26A69A',
    valueAreaColor: '#FF9800',
    pocColor: '#F44336',
    valueLinesColor: '#2196F3'
  };
}

function withAlpha(hex, alpha) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** Un Volume Profile por sesión. Solo usa las velas ya ocurridas en la hora simulada */
class VolumeProfilePeriodicIndicator extends IndicatorBase {
  constructor(symbol, interval, days, profiles) {
    super(symbol, interval, days);
    this.name = 'VP Periodic';
    this.height = 0;
    this.enabled = false;
    this.profiles = profiles;
    this.config = { ...defaultVPPeriodicConfig(), ...loadVPPeriodicSettings(symbol) };
  }

  async fetchData() {
    return true;
  }

  updateConfig(config) {
    this.config = { ...this.config, ...config };
  }

  /** Sesiones que tocan las velas visibles, con su perfil */
  sessionsInView(visibleCandles, known, priceContext) {
    const { periodHours, rows, valueAreaPercent } = this.config;
    const length = sessionLength(periodHours);
    const last = visibleCandles[visibleCandles.length - 1].timestamp;
    const sessions = [];

    for (let start = sessionStart(visibleCandles[0].timestamp, periodHours); start <= last; start += length) {
      const candles = candlesBetween(known, start, start + length);
      const profile = this.profiles.get({
        start,
        end: start + length,
        candles,
        rows,
        valueAreaShare: valueAreaPercent / 100,
        knownUntil: priceContext.knownUntil,
        requestRedraw: priceContext.requestRedraw
      });
      if (profile) sessions.push({ start, candles, profile });
    }
    return sessions;
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext = null) {
    if (!this.enabled || !visibleCandles?.length || !priceContext?.priceToY || !priceContext.timeToX) return;

    const known = priceContext.knownCandles || allCandles;
    if (!known?.length) return;

    this.shownSessions = this.sessionsInView(visibleCandles, known, priceContext);
    for (const session of this.shownSessions) {
      this._drawSession(ctx, bounds, session, priceContext);
    }
  }

  selectableLevels() {
    const length = sessionLength(this.config.periodHours);
    return (this.shownSessions || []).flatMap(({ start, profile }) => (
      profileLevels(profile, 'VP Periodic', { start, end: start + length })
    ));
  }

  _drawSession(ctx, bounds, { candles, profile }, priceContext) {
    const { priceToY, timeToX } = priceContext;
    const { baseColor, valueAreaColor, pocColor, valueLinesColor, histogramWidthPercent, showPOC, showValueArea, showLabels } = this.config;

    const startX = timeToX(candles[0].timestamp);
    const endX = timeToX(candles[candles.length - 1].timestamp);
    const left = Math.max(bounds.x, startX);
    const right = Math.min(bounds.x + bounds.width, endX);
    if (right <= left) return;

    const top = bounds.y;
    const bottom = bounds.y + bounds.height;
    // Las líneas son verticales u horizontales: su grosor cae entero en píxeles reales
    const line = (color, width, dash, x1, y1, x2, y2) => {
      const vertical = x1 === x2;
      const horizontal = y1 === y2;
      ctx.strokeStyle = color;
      ctx.lineWidth = vertical ? crispWidth(width, 'x') : (horizontal ? crispWidth(width) : width);
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(vertical ? alignX(x1, width) : x1, horizontal ? alignY(y1, width) : y1);
      ctx.lineTo(vertical ? alignX(x2, width) : x2, horizontal ? alignY(y2, width) : y2);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    if (startX >= bounds.x) line(withAlpha(baseColor, 0.3), 1, [4, 4], startX, top, startX, bottom);

    const maxWidth = (right - left) * (histogramWidthPercent / 100);
    for (const level of profile.levels) {
      if (level.volume <= 0) continue;
      const y = priceToY(level.levelHigh);
      const height = Math.max(1, Math.abs(priceToY(level.levelLow) - y) - 1);
      if (y + height < top || y > bottom) continue;

      const share = level.volume / profile.maxVolume;
      ctx.fillStyle = withAlpha(level.isValueArea ? valueAreaColor : baseColor, 0.15 + share * 0.6);
      ctx.fillRect(left, y, maxWidth * share, height);
    }

    if (showPOC) {
      const y = priceToY(profile.poc.price);
      if (y >= top && y <= bottom) line(pocColor, 1.5, [3, 3], left, y, right, y);
    }

    if (showValueArea) {
      for (const price of [profile.valueArea.vahPrice, profile.valueArea.valPrice]) {
        const y = priceToY(price);
        if (y >= top && y <= bottom) line(withAlpha(valueLinesColor, 0.5), 1, [], left, y, right, y);
      }
    }

    if (showLabels && startX >= bounds.x) {
      ctx.fillStyle = withAlpha(baseColor, 0.9);
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`POC ${profile.poc.price.toFixed(2)}${profile.isReal ? ' · real' : ''}`, left + 3, top + 12);
    }
  }

  render() {
    // Solo dibuja sobre el gráfico de precio
  }
}

export default VolumeProfilePeriodicIndicator;
