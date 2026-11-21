import IndicatorBase from './IndicatorBase.js';
import { candleItemId } from './analysisLevels.js';
import { THEME, isNewTheme, priceDecimals } from '../uiTheme.js';
import { alignY, crispWidth, candleColumns, snapSpanY, pixelRatio } from '../chartPixels.js';
import { maskPriceDelta, priceText, pricesHidden } from '../backtesting/blindClock.js';
import { intervalMinutes } from './HorizontalRangesIndicator.js';
import { MFI_LABELS, WISE_NAMES } from './williams.js';

/**
 * Los indicadores de Bill Williams en el gráfico (20/11/2026). Comparten un WilliamsHub por gráfico (williams.js):
 * una sola configuración y un solo cálculo de la ventana a la vista, con velas cerradas. La vela en formación solo
 * mueve los valores provisionales de los paneles (AO, AC, Gator) y las líneas del Alligator, que en ella ya se saben.
 *
 * Sobre las velas: Alligator, Fractales, Zonas de Williams y Tres sabios. Paneles: AO, AC, Gator y MFI.
 */

const MAX_VISIBLE = 3000;   // Con más velas a la vista los dibujos no se alcanzan a leer
const STRIP = 4;            // Alto de la tira de estado (Alligator) o de zonas

export function rgba(hex, alpha) {
  const value = parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(value)) return `rgba(128, 128, 128, ${alpha})`;
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** Un valor del AO o del AC: en la escala oculta si la fecha está oculta */
export function deltaText(value, reference) {
  if (!Number.isFinite(value)) return '–';
  const shown = pricesHidden() ? maskPriceDelta(value) : value;
  const base = pricesHidden() ? 100 : Math.abs(reference) || 1;
  const digits = base >= 1000 ? 1 : base >= 100 ? 2 : base >= 1 ? 3 : 5;
  return `${shown >= 0 ? '+' : ''}${shown.toFixed(digits)}`;
}

/** La base de todos: el cálculo compartido y la configuración (la de todos los indicadores de Williams) */
class WilliamsBase extends IndicatorBase {
  constructor(symbol, interval, days, hub, name, height = 0) {
    super(symbol, interval, days);
    this.name = name;
    this.height = height;
    this.enabled = false;
    this.hub = hub;
    this.view = null;
    this.visible = [];
    this.items = [];
  }

  get config() {
    return this.hub.config;
  }

  set config(value) {
    if (value) this.hub.setConfig(value);
  }

  async fetchData() {
    return null;
  }

  render() {}

  updateConfig(config) {
    this.hub.setConfig(config);
  }

  selectableLevels() {
    return this.items;
  }

  /** Índice de la vela en el cálculo, o "forming" si es la vela en formación */
  _at(candle) {
    if (candle.in_progress && this.view?.forming && candle.timestamp === this.view.forming.timestamp) return 'forming';
    return this.hub.indexOf(candle.timestamp);
  }

  _prepare(visibleCandles, allCandles, priceContext) {
    this.items = [];
    this.view = null;
    this.visible = visibleCandles || [];
    if (!this.enabled || !visibleCandles?.length || visibleCandles.length > MAX_VISIBLE) return false;
    this.view = this.hub.window(visibleCandles, priceContext?.knownCandles || allCandles);
    return !!this.view;
  }
}

// ==================== SOBRE LAS VELAS ====================

const LINES = [
  ['jaw', 'jawColor', 'mandíbula', 'jawLen', 'jawShift', 'jawRaw'],
  ['teeth', 'teethColor', 'dientes', 'teethLen', 'teethShift', 'teethRaw'],
  ['lips', 'lipsColor', 'labios', 'lipsLen', 'lipsShift', 'lipsRaw']
];

export class AlligatorIndicator extends WilliamsBase {
  constructor(symbol, interval, days, hub) {
    super(symbol, interval, days, hub, 'Alligator');
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this._prepare(visibleCandles, allCandles, priceContext) || !priceContext?.priceToY) return;
    const cfg = this.config.alligator;
    const { result, formingValues } = this.view;
    const barWidth = bounds.width / visibleCandles.length;
    const center = (i) => bounds.x + i * barWidth + barWidth / 2;
    const valueAt = (key, i) => {
      const at = this._at(visibleCandles[i]);
      if (at === 'forming') return formingValues?.[key] ?? NaN;
      return at >= 0 ? result[key][at] : NaN;
    };

    ctx.save();
    ctx.lineJoin = 'round';
    for (const [key, colorKey, label, lenKey, shiftKey, rawKey] of LINES) {
      ctx.strokeStyle = cfg[colorKey];
      ctx.lineWidth = cfg.width;
      ctx.beginPath();
      let drawing = false;
      let lastIndex = -1;
      for (let i = 0; i < visibleCandles.length; i += 1) {
        const value = valueAt(key, i);
        if (!Number.isFinite(value)) {
          drawing = false;
          continue;
        }
        const y = priceContext.priceToY(value);
        if (drawing) ctx.lineTo(center(i), y);
        else ctx.moveTo(center(i), y);
        drawing = true;
        lastIndex = i;
        if (barWidth >= 3) {
          const candle = visibleCandles[i];
          this.items.push({
            id: candleItemId('Alligator', `Alligator, ${label} (${cfg[lenKey]}/${cfg[shiftKey]})`, candle.timestamp, null, this.interval),
            source: 'Alligator', kind: `Alligator, ${label} (${cfg[lenKey]}/${cfg[shiftKey]})`, price: value, time: candle.timestamp,
            left: center(i) - barWidth / 2, right: center(i) + barWidth / 2, y
          });
        }
      }
      ctx.stroke();

      // Proyección: lo que ya se sabe de las próximas velas (el valor desplazado de velas cerradas)
      if (cfg.projection && lastIndex === visibleCandles.length - 1) {
        const n = result.n;
        const shift = cfg[shiftKey];
        const raw = result[rawKey];
        const lastClosedVisible = visibleCandles[lastIndex].in_progress ? lastIndex - 1 : lastIndex;
        if (lastClosedVisible >= 0 && this.hub.indexOf(visibleCandles[lastClosedVisible].timestamp) === n - 1 && shift > 0) {
          ctx.setLineDash([4, 3]);
          ctx.globalAlpha = 0.7;
          ctx.beginPath();
          let started = false;
          for (let j = lastClosedVisible; j <= lastClosedVisible + shift; j += 1) {
            const value = raw[n - 1 - shift + (j - lastClosedVisible)];
            if (!Number.isFinite(value)) continue;
            const x = center(j);
            const y = priceContext.priceToY(value);
            if (started) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
            started = true;
          }
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
      }
    }

    // Tira de estado bajo las velas: al alza, a la baja o dormido
    if (cfg.showState) {
      const bottom = bounds.y + bounds.height - STRIP;
      for (let i = 0; i < visibleCandles.length; i += 1) {
        const at = this._at(visibleCandles[i]);
        if (at === 'forming' || at < 0) continue;
        const state = result.state[at];
        ctx.fillStyle = state > 0 ? rgba(cfg.lipsColor, 0.75) : state < 0 ? rgba(cfg.teethColor, 0.75) : 'rgba(140, 140, 140, 0.45)';
        ctx.fillRect(bounds.x + i * barWidth, bottom, Math.max(1, barWidth), STRIP);
      }
    }
    ctx.restore();
  }
}

export class FractalsIndicator extends WilliamsBase {
  constructor(symbol, interval, days, hub) {
    super(symbol, interval, days, hub, 'Fractales');
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this._prepare(visibleCandles, allCandles, priceContext) || !priceContext?.priceToY) return;
    const cfg = this.config.fractals;
    const { result, bars } = this.view;
    const barWidth = bounds.width / visibleCandles.length;
    if (barWidth < 1.5) return;
    const first = this.hub.indexOf(visibleCandles[0].timestamp);
    if (first < 0) return;
    const size = Math.max(3, Math.min(6, barWidth * 0.4));
    ctx.save();
    for (const f of result.fractals) {
      if (f.dir > 0 ? !cfg.showUp : !cfg.showDown) continue;
      const i = f.index - first;
      if (i < 0 || i >= visibleCandles.length) continue;
      const teeth = result.teeth[f.known];
      const outside = !Number.isFinite(teeth) || (f.dir > 0 ? f.price > teeth : f.price < teeth);
      const color = cfg.alligatorFilter && !outside ? 'rgba(140, 140, 140, 0.85)' : (f.dir > 0 ? cfg.upColor : cfg.downColor);
      const x = bounds.x + i * barWidth + barWidth / 2;
      const y = priceContext.priceToY(f.price) + (f.dir > 0 ? -4 : 4);
      ctx.fillStyle = color;
      ctx.beginPath();
      if (f.dir > 0) {
        ctx.moveTo(x, y - size * 1.4);
        ctx.lineTo(x - size, y);
        ctx.lineTo(x + size, y);
      } else {
        ctx.moveTo(x, y + size * 1.4);
        ctx.lineTo(x - size, y);
        ctx.lineTo(x + size, y);
      }
      ctx.closePath();
      ctx.fill();
      const kind = `Fractal ${f.dir > 0 ? 'de máximo' : 'de mínimo'}${cfg.alligatorFilter && !outside ? ' (dentro de la boca)' : ''}`;
      this.items.push({
        id: candleItemId('Fractales', kind, bars.t[f.index], null, this.interval), source: 'Fractales', kind,
        price: f.price, time: bars.t[f.known], mark: true, x, y: y + (f.dir > 0 ? -size * 0.7 : size * 0.7), r: size + 3
      });
    }
    ctx.restore();
  }
}

export class WilliamsZonesIndicator extends WilliamsBase {
  constructor(symbol, interval, days, hub, orderFlowOn = () => false) {
    super(symbol, interval, days, hub, 'Zonas de Williams');
    this.orderFlowOn = orderFlowOn;
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this._prepare(visibleCandles, allCandles, priceContext) || !priceContext?.priceToY) return;
    const cfg = this.config.zones;
    const { result, formingValues } = this.view;
    const barWidth = bounds.width / visibleCandles.length;
    const zoneAt = (candle) => {
      const at = this._at(candle);
      if (at === 'forming') return formingValues?.zone ?? NaN;
      return at >= 0 ? result.zone[at] : NaN;
    };
    const colorOf = (zone) => (zone > 0 ? cfg.green : zone < 0 ? cfg.red : cfg.gray);
    // Con los footprints a la vista no se repintan las velas: se marca la tira de arriba
    const strip = cfg.mode === 'strip' || (barWidth >= 16 && this.orderFlowOn());
    ctx.save();
    if (strip) {
      for (let i = 0; i < visibleCandles.length; i += 1) {
        const zone = zoneAt(visibleCandles[i]);
        if (!Number.isFinite(zone)) continue;
        ctx.fillStyle = colorOf(zone);
        ctx.fillRect(bounds.x + i * barWidth, bounds.y + 1, Math.max(1, barWidth), STRIP);
      }
      ctx.restore();
      return;
    }
    const crisp = barWidth * pixelRatio() >= 1;
    for (let i = 0; i < visibleCandles.length; i += 1) {
      const d = visibleCandles[i];
      const zone = zoneAt(d);
      if (!Number.isFinite(zone)) continue;
      const x = bounds.x + i * barWidth;
      const yOpen = priceContext.priceToY(d.open);
      const yClose = priceContext.priceToY(d.close);
      const yHigh = priceContext.priceToY(d.high);
      const yLow = priceContext.priceToY(d.low);
      ctx.fillStyle = colorOf(zone);
      ctx.strokeStyle = ctx.fillStyle;
      // La misma vela que dibuja MiniChart, en el color de su zona
      if (crisp) {
        const columns = candleColumns(x + barWidth / 2, Math.max(barWidth * 0.7, 2));
        const height = Math.abs(yClose - yOpen);
        const bodyTop = height < 2 ? (yOpen + yClose) / 2 - 1.5 : Math.min(yOpen, yClose);
        const [wickY, wickHeight] = snapSpanY(yHigh, yLow);
        const [bodyY, bodyHeight] = snapSpanY(bodyTop, bodyTop + (height < 2 ? 3 : Math.max(height, 2)));
        ctx.fillRect(columns.wickX, wickY, columns.wickWidth, wickHeight);
        ctx.fillRect(columns.bodyX, bodyY, columns.bodyWidth, bodyHeight);
      } else {
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + barWidth / 2, yHigh);
        ctx.lineTo(x + barWidth / 2, yLow);
        ctx.stroke();
        const width = Math.max(barWidth * 0.7, 2);
        const height = Math.abs(yClose - yOpen);
        if (height < 2) ctx.fillRect(x + (barWidth - width) / 2, (yOpen + yClose) / 2 - 1.5, width, 3);
        else ctx.fillRect(x + (barWidth - width) / 2, Math.min(yOpen, yClose), width, Math.max(height, 2));
      }
    }
    ctx.restore();
  }
}

export class WiseMenIndicator extends WilliamsBase {
  constructor(symbol, interval, days, hub) {
    super(symbol, interval, days, hub, 'Tres sabios');
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this._prepare(visibleCandles, allCandles, priceContext) || !priceContext?.priceToY) return;
    const cfg = this.config.wise;
    const { result, bars } = this.view;
    const barWidth = bounds.width / visibleCandles.length;
    const first = this.hub.indexOf(visibleCandles[0].timestamp);
    const lastVisible = this.hub.indexOf(visibleCandles[visibleCandles.length - 1].timestamp);
    if (first < 0) return;
    const center = (index) => bounds.x + (index - first) * barWidth + barWidth / 2;
    const right = bounds.x + bounds.width;
    const show = { 1: cfg.first, 2: cfg.second, 3: cfg.third };
    const radius = Math.max(5, Math.min(8, barWidth * 0.45));
    const nitido = isNewTheme();
    const digits = priceDecimals(visibleCandles);
    ctx.save();
    ctx.font = `bold ${Math.round(radius * 1.3)}px ${nitido ? THEME.font : 'Inter, sans-serif'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const s of result.signals) {
      if (!show[s.wise]) continue;
      const endIndex = s.endAt ?? (lastVisible >= 0 ? Math.max(lastVisible, s.index) : s.index);
      if (endIndex < first || s.index - first > visibleCandles.length + 2) continue;
      const color = s.dir > 0 ? cfg.upColor : cfg.downColor;
      const x0 = center(s.wise === 3 ? (s.fractalKnown ?? s.index) : s.index);
      const x1 = s.endAt !== null ? center(s.endAt) : right;
      const yEntry = priceContext.priceToY(s.entry);

      // Línea de la entrada stop: sólida si se llenó, punteada mientras espera, gris si se canceló o venció
      if (cfg.showEntries && x1 > bounds.x) {
        ctx.strokeStyle = s.end === 'filled' || s.end === null ? color : 'rgba(140, 140, 140, 0.8)';
        ctx.lineWidth = crispWidth(1);
        ctx.setLineDash(s.end === 'filled' ? [] : [4, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.max(bounds.x, x0), alignY(yEntry));
        ctx.lineTo(Math.min(right, x1), alignY(yEntry));
        ctx.stroke();
      }
      if (cfg.showStops && s.wise !== 3 && x1 > bounds.x) {
        const yStop = priceContext.priceToY(s.stop);
        ctx.strokeStyle = 'rgba(140, 140, 140, 0.7)';
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.max(bounds.x, center(s.index)), alignY(yStop));
        ctx.lineTo(Math.min(right, x1), alignY(yStop));
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // El número del sabio junto a la vela de la señal
      const i = s.index - first;
      if (i < 0 || i >= visibleCandles.length) continue;
      const xs = center(s.index);
      const extreme = s.dir > 0 ? bars.l[s.index] : bars.h[s.index];
      const y = priceContext.priceToY(extreme) + (s.dir > 0 ? radius + 6 : -radius - 6);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(xs, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(String(s.wise), xs, y + 0.5);
      const state = s.end === 'filled' ? 'llenada' : s.end === 'stop' ? 'cancelada: tocó su stop' : s.end === 'expired' ? 'vencida' : s.end === 'replaced' ? 'reemplazada' : 'esperando';
      const kind = `${s.wise}.º sabio, ${WISE_NAMES[s.wise].toLowerCase()} ${s.dir > 0 ? 'alcista' : 'bajista'} · entrada ${priceText(s.entry, digits)} · ${state}`;
      this.items.push({
        id: candleItemId('Tres sabios', `${s.wise}|${s.dir}`, bars.t[s.index], null, this.interval), source: 'Tres sabios', kind,
        price: s.entry, time: bars.t[s.index], mark: true, x: xs, y, r: radius + 3
      });
    }
    ctx.restore();
  }
}

// ==================== PANELES ====================

class WilliamsPanel extends WilliamsBase {
  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    this._prepare(visibleCandles, allCandles, priceContext);
    this.lastPrice = visibleCandles?.[visibleCandles.length - 1]?.close;
    this.drawOnPrice?.(ctx, bounds, visibleCandles, priceContext);
  }

  /** Valor y color de una vela del panel: { value, dir } o null */
  pointAt() {
    return null;
  }

  frame(ctx, bounds, title, reading) {
    const { x, y, width, height } = bounds;
    ctx.fillStyle = isNewTheme() ? THEME.chartBg : '#FFFFFF';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = THEME.dark ? THEME.grid : '#DDE2E7';
    ctx.lineWidth = crispWidth(1);
    ctx.beginPath();
    ctx.moveTo(x, alignY(y));
    ctx.lineTo(x + width, alignY(y));
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = THEME.dark ? THEME.textMuted : '#666';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.fillText(title, x + 5, y + 15);
    if (reading) {
      const titleWidth = ctx.measureText(title).width;
      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = THEME.dark ? THEME.textFaint : '#888';
      ctx.fillText(reading, x + 15 + titleWidth, y + 15);
    }
  }

  /** El último punto con dato a la vista, para el texto del panel */
  lastPoint(visibleCandles) {
    for (let i = visibleCandles.length - 1; i >= 0; i -= 1) {
      const point = this.pointAt(visibleCandles[i]);
      if (point && Number.isFinite(point.value)) return point;
    }
    return null;
  }

  /** Histograma alrededor de cero: barras con su color */
  histogram(ctx, bounds, visibleCandles, colors) {
    const { x, y, width, height } = bounds;
    const top = y + 20;
    const half = (height - 24) / 2;
    const zero = top + half;
    const points = visibleCandles.map(candle => this.pointAt(candle));
    let max = 0;
    for (const p of points) if (p) for (const value of [p.value, p.lower]) if (Number.isFinite(value)) max = Math.max(max, Math.abs(value));
    if (!(max > 0)) return;
    const scale = half / max;
    const barWidth = width / visibleCandles.length;
    ctx.strokeStyle = THEME.dark ? THEME.crosshair : '#B0BEC5';
    ctx.lineWidth = crispWidth(1);
    ctx.beginPath();
    ctx.moveTo(x, alignY(zero));
    ctx.lineTo(x + width, alignY(zero));
    ctx.stroke();
    points.forEach((p, i) => {
      if (!p) return;
      const left = x + i * barWidth + barWidth * 0.1;
      const w = Math.max(barWidth * 0.8, 0.5);
      for (const [value, dir] of [[p.value, p.dir], [p.lower, p.lowerDir]]) {
        if (!Number.isFinite(value)) continue;
        const shown = value * scale;
        ctx.globalAlpha = p.provisional ? 0.5 : 1;
        ctx.fillStyle = dir > 0 ? colors.up : colors.down;
        ctx.fillRect(left, shown >= 0 ? zero - shown : zero, w, Math.max(Math.abs(shown), 0.5));
      }
      ctx.globalAlpha = 1;
    });
    return { zero, scale, barWidth };
  }

  panelReadings(candles) {
    const readings = new Map();
    for (const candle of candles) {
      if (candle.in_progress) continue;
      const text = this.readingAt?.(candle);
      if (text) readings.set(candle.timestamp, text);
    }
    return readings;
  }
}

export class AOIndicator extends WilliamsPanel {
  constructor(symbol, interval, days, hub) {
    super(symbol, interval, days, hub, 'AO', 80);
  }

  pointAt(candle) {
    const at = this._at(candle);
    if (at === 'forming') {
      const f = this.view?.formingValues;
      return f && Number.isFinite(f.ao) ? { value: f.ao, dir: f.aoDir, provisional: true } : null;
    }
    if (at < 0) return null;
    const value = this.view.result.ao[at];
    return Number.isFinite(value) ? { value, dir: this.view.result.aoDir[at] } : null;
  }

  readingAt(candle) {
    const p = this.pointAt(candle);
    if (!p) return null;
    return `AO ${deltaText(p.value, candle.close)} · ${p.dir > 0 ? 'verde, sube' : p.dir < 0 ? 'roja, baja' : 'sin color'} · ${p.value >= 0 ? 'sobre el cero' : 'bajo el cero'}`;
  }

  render(ctx, bounds, visibleCandles) {
    if (!this.enabled || !visibleCandles?.length) return;
    const cfg = this.config.ao;
    const last = this.lastPoint(visibleCandles);
    this.frame(ctx, bounds, `Awesome Oscillator (AO ${cfg.fast}/${cfg.slow})`,
      last ? `${deltaText(last.value, this.lastPrice)} · ${last.dir > 0 ? 'sube' : 'baja'}` : '');
    if (!this.view) return;
    const drawn = this.histogram(ctx, bounds, visibleCandles, { up: cfg.upColor, down: cfg.downColor });
    // La tercera barra del mismo color (2.º sabio): un punto sobre su barra
    if (drawn && cfg.showSuper) {
      const first = this.hub.indexOf(visibleCandles[0].timestamp);
      if (first < 0) return;
      for (const s of this.view.result.signals) {
        if (s.wise !== 2) continue;
        const i = s.index - first;
        if (i < 0 || i >= visibleCandles.length) continue;
        const value = this.view.result.ao[s.index];
        const xs = bounds.x + i * drawn.barWidth + drawn.barWidth / 2;
        const ys = drawn.zero - value * drawn.scale + (value >= 0 ? -5 : 5);
        ctx.fillStyle = s.dir > 0 ? cfg.upColor : cfg.downColor;
        ctx.beginPath();
        ctx.arc(xs, ys, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

export class ACIndicator extends WilliamsPanel {
  constructor(symbol, interval, days, hub) {
    super(symbol, interval, days, hub, 'AC', 70);
  }

  pointAt(candle) {
    const at = this._at(candle);
    if (at === 'forming') {
      const f = this.view?.formingValues;
      return f && Number.isFinite(f.ac) ? { value: f.ac, dir: f.acDir, provisional: true } : null;
    }
    if (at < 0) return null;
    const value = this.view.result.ac[at];
    return Number.isFinite(value) ? { value, dir: this.view.result.acDir[at] } : null;
  }

  readingAt(candle) {
    const p = this.pointAt(candle);
    if (!p) return null;
    return `AC ${deltaText(p.value, candle.close)} · ${p.dir > 0 ? 'verde, acelera al alza' : p.dir < 0 ? 'roja, acelera a la baja' : 'sin color'}`;
  }

  render(ctx, bounds, visibleCandles) {
    if (!this.enabled || !visibleCandles?.length) return;
    const cfg = this.config.ac;
    const last = this.lastPoint(visibleCandles);
    this.frame(ctx, bounds, `Accelerator (AC, AO − media de ${cfg.signal})`,
      last ? `${deltaText(last.value, this.lastPrice)} · ${last.dir > 0 ? 'sube' : 'baja'}` : '');
    if (this.view) this.histogram(ctx, bounds, visibleCandles, { up: cfg.upColor, down: cfg.downColor });
  }
}

const GATOR_PHASE = (up, down) => (up > 0 && down > 0 ? 'come' : up < 0 && down < 0 ? 'duerme' : 'despierta o se sacia');

export class GatorIndicator extends WilliamsPanel {
  constructor(symbol, interval, days, hub) {
    super(symbol, interval, days, hub, 'Gator', 70);
  }

  pointAt(candle) {
    const at = this._at(candle);
    if (at === 'forming') {
      const f = this.view?.formingValues;
      return f && Number.isFinite(f.gUp) ? { value: f.gUp, dir: f.gUpDir, lower: f.gDown, lowerDir: f.gDownDir, provisional: true } : null;
    }
    if (at < 0) return null;
    const r = this.view.result;
    return Number.isFinite(r.gUp[at]) ? { value: r.gUp[at], dir: r.gUpDir[at], lower: r.gDown[at], lowerDir: r.gDownDir[at] } : null;
  }

  readingAt(candle) {
    const p = this.pointAt(candle);
    if (!p) return null;
    return `Gator: ${GATOR_PHASE(p.dir, p.lowerDir)} (arriba ${p.dir > 0 ? 'crece' : 'se achica'}, abajo ${p.lowerDir > 0 ? 'crece' : 'se achica'})`;
  }

  render(ctx, bounds, visibleCandles) {
    if (!this.enabled || !visibleCandles?.length) return;
    const cfg = this.config.gator;
    const last = this.lastPoint(visibleCandles);
    this.frame(ctx, bounds, 'Gator Oscillator', last ? GATOR_PHASE(last.dir, last.lowerDir) : '');
    if (this.view) this.histogram(ctx, bounds, visibleCandles, { up: cfg.upColor, down: cfg.downColor });
  }
}

export class MFIIndicator extends WilliamsPanel {
  constructor(symbol, interval, days, hub) {
    super(symbol, interval, days, hub, 'MFI', 60);
  }

  pointAt(candle) {
    const at = this._at(candle);
    if (at === 'forming' || at < 0) return null; // El MFI de una vela sin cerrar no sirve: su volumen sigue creciendo
    const r = this.view.result;
    return Number.isFinite(r.mfi[at]) ? { value: r.mfi[at], type: r.mfiType[at] } : null;
  }

  readingAt(candle) {
    const p = this.pointAt(candle);
    if (!p || !p.type) return null;
    return `MFI: ${MFI_LABELS[p.type].toLowerCase()} (${p.type === 1 ? 'suben el MFI y el volumen' : p.type === 2 ? 'bajan los dos' : p.type === 3 ? 'sube el MFI y baja el volumen' : 'baja el MFI y sube el volumen'})`;
  }

  drawOnPrice(ctx, bounds, visibleCandles, priceContext) {
    const cfg = this.config.mfi;
    if (!cfg.squatOnPrice || !this.view || !priceContext?.priceToY) return;
    const barWidth = bounds.width / visibleCandles.length;
    if (barWidth < 2) return;
    ctx.save();
    ctx.fillStyle = cfg.squat;
    visibleCandles.forEach((candle, i) => {
      const p = this.pointAt(candle);
      if (!p || p.type !== 4) return;
      const x = bounds.x + i * barWidth + barWidth / 2;
      const y = priceContext.priceToY(candle.low) + 7;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, Math.min(4, barWidth * 0.3)), 0, Math.PI * 2);
      ctx.fill();
      this.items.push({
        id: candleItemId('MFI', 'Squat', candle.timestamp, null, this.interval), source: 'MFI', kind: 'Squat (MFI baja y el volumen sube)',
        price: candle.low, time: candle.timestamp, mark: true, x, y, r: 6
      });
    });
    ctx.restore();
  }

  render(ctx, bounds, visibleCandles) {
    if (!this.enabled || !visibleCandles?.length) return;
    const cfg = this.config.mfi;
    const last = this.lastPoint(visibleCandles);
    this.frame(ctx, bounds, 'MFI de Williams', last?.type ? MFI_LABELS[last.type] : '');
    if (!this.view) return;
    const { x, y, width, height } = bounds;
    const points = visibleCandles.map(candle => this.pointAt(candle));
    let max = 0;
    for (const p of points) if (p) max = Math.max(max, p.value);
    if (!(max > 0)) return;
    const base = y + height - 3;
    const scale = (height - 24) / max;
    const barWidth = width / visibleCandles.length;
    const colors = { 1: cfg.green, 2: cfg.fade, 3: cfg.fake, 4: cfg.squat };
    points.forEach((p, i) => {
      if (!p) return;
      ctx.fillStyle = colors[p.type] || 'rgba(140, 140, 140, 0.6)';
      const h = Math.max(0.5, p.value * scale);
      ctx.fillRect(x + i * barWidth + barWidth * 0.1, base - h, Math.max(barWidth * 0.8, 0.5), h);
    });
    // Leyenda de los cuatro colores
    ctx.font = '10px Inter, sans-serif';
    ctx.textBaseline = 'alphabetic';
    let lx = x + width - 4;
    for (const type of [4, 3, 2, 1]) {
      const label = MFI_LABELS[type];
      const w = ctx.measureText(label).width;
      lx -= w;
      ctx.fillStyle = colors[type];
      ctx.fillText(label, lx, y + 15);
      lx -= 10;
    }
  }
}

/** Minutos de una vela del gráfico (para quien lo necesite fuera de este archivo) */
export const candleMinutes = (interval) => intervalMinutes(interval);
