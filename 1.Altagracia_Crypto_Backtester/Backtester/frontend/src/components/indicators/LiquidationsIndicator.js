import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';
import { isBlind } from '../backtesting/blindClock.js';
import {
  CrossTracker, DAY_MS, activeSource, binWidthFor, buildZones, coverageText, defaultPickRules, defaultZoneRules, knownAfter, money,
  pickZones, windowRange
} from './liquidationZones.js';

const SETTINGS_KEY = 'liquidations_settings_';
const REQUEST_GAP_MS = 400; // Tiempo real mínimo entre dos pedidos
const ADVANCE_MS = 5 * 60000; // Tiempo simulado que debe pasar para pedir eventos nuevos
const FETCH_PAD_MS = 2 * DAY_MS; // Margen de una carga completa, para retroceder un poco sin volver a pedir
const TRIM_EVERY_MS = 7 * DAY_MS; // Lo que salió de la ventana se suelta cada semana simulada
const RETRY_WAIT_MS = 15000;
const WIDTH_DRIFT = 0.3; // El ancho de franja solo cambia si el precio se aleja 30% del que lo fijó
const MIN_ALPHA = 0.06;
const CROSSED_DIM = 0.5; // Una zona que el precio ya atravesó queda como referencia, más tenue
const LABEL_GAP_PX = 12;
const LABEL_RIGHT_LIMIT = 0.6; // Una etiqueta no empieza en el 40% derecho del gráfico

// Lo que el modal deja cambiar. Las reglas internas de las zonas (maxHalfBins, halfFraction) no se guardan:
// así un cambio de sus valores de fábrica llega también a quien ya guardó parámetros
const USER_KEYS = [
  'lookbackDays', 'binPct', 'perSide', 'maxDistancePct', 'minShare', 'minGapPct', 'showLongs', 'showShorts', 'source',
  'longColor', 'shortColor', 'maxOpacity', 'showLabels', 'showOffscreen'
];
const userPart = (settings) => Object.fromEntries(USER_KEYS.filter(key => settings?.[key] !== undefined).map(key => [key, settings[key]]));

/** Parámetros guardados de un símbolo; sin almacenamiento disponible quedan los de fábrica */
export function loadLiquidationsSettings(symbol) {
  try {
    return userPart(JSON.parse(localStorage.getItem(SETTINGS_KEY + symbol)) || {});
  } catch {
    return {};
  }
}

export function saveLiquidationsSettings(symbol, settings) {
  try {
    localStorage.setItem(SETTINGS_KEY + symbol, JSON.stringify(userPart(settings)));
  } catch {
    // Sin almacenamiento los parámetros siguen vigentes hasta recargar
  }
}

export function defaultLiquidationsConfig() {
  return {
    ...defaultZoneRules(),
    ...defaultPickRules(),
    source: 'auto', // 'auto': la mejor fuente de cada fecha. Un id fija esa fuente
    longColor: '#E91E63', // Largos liquidados: el precio bajó hasta ahí
    shortColor: '#00ACC1', // Cortos liquidados: el precio subió hasta ahí
    maxOpacity: 0.35,
    showLabels: true,
    showOffscreen: true // Aviso de zonas elegidas que quedan arriba o abajo de la vista
  };
}

export const SOURCE_CHOICES = [
  ['auto', 'Automática: la mejor de cada fecha'],
  ['marginpad', 'MarginPad: todo el mercado'],
  ['coinalyze', 'Coinalyze: todo el mercado, precio estimado'],
  ['binance_cm', 'Binance Coin-M: un solo mercado'],
  ['bitfinex', 'Bitfinex: un mercado pequeño']
];

// Parámetro: [mínimo, máximo]. Fuera del rango se ajusta al guardar.
const NUMBER_LIMITS = {
  perSide: [1, 8],
  maxDistancePct: [0.5, 30],
  minGapPct: [0, 3],
  lookbackDays: [1, 90],
  binPct: [0.02, 1],
  minShare: [0, 1],
  maxOpacity: [0.05, 0.8]
};
const INTEGERS = ['perSide', 'lookbackDays'];

/** Valores del modal listos para aplicar: números dentro de su rango y una fuente que existe */
export function cleanLiquidationsSettings(values) {
  const defaults = defaultLiquidationsConfig();
  const clean = { ...defaults, ...values };
  for (const [key, [min, max]] of Object.entries(NUMBER_LIMITS)) {
    const number = parseFloat(values[key]);
    clean[key] = Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : defaults[key];
  }
  for (const key of INTEGERS) clean[key] = Math.round(clean[key]);
  if (!SOURCE_CHOICES.some(([id]) => id === clean.source)) clean.source = 'auto';
  for (const key of ['showLongs', 'showShorts', 'showLabels', 'showOffscreen']) clean[key] = !!clean[key];
  for (const key of ['longColor', 'shortColor']) if (!/^#[0-9a-fA-F]{6}$/.test(clean[key])) clean[key] = defaults[key];
  return clean;
}

function withOpacity(hex, opacity) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
}

const utcDate = (timestamp) => new Date(timestamp).toISOString().slice(0, 10).split('-').reverse().join('/');

/** Largo de un intervalo: 15 min, 1 h, 1 día */
export function spanText(ms) {
  if (ms >= DAY_MS) return ms === DAY_MS ? '1 día' : `${Math.round(ms / DAY_MS)} días`;
  if (ms >= 3600000) return `${Math.round(ms / 3600000)} h`;
  return `${Math.round(ms / 60000)} min`;
}

/** Edad corta: 45m, 6h, 3d */
export function ageText(ms) {
  if (ms < 3600000) return `${Math.max(0, Math.round(ms / 60000))}m`;
  if (ms < DAY_MS) return `${Math.round(ms / 3600000)}h`;
  return `${Math.round(ms / DAY_MS)}d`;
}

/** Texto de una zona: lado principal y monto, y el otro lado si pesa al menos un cuarto */
export function zoneLabel(zone, blind = false) {
  const main = zone.side === 'long' ? zone.long : zone.short;
  const other = zone.side === 'long' ? zone.short : zone.long;
  const letter = zone.side === 'long' ? 'L' : 'C';
  // Con fecha oculta el monto delataría la fuente, y la fuente la época: va la parte de la mayor zona
  if (blind) return `${letter} ${Math.round(zone.share * 100)}%`;
  const extra = other >= zone.total / 4 ? ` + ${zone.side === 'long' ? 'C' : 'L'} ${money(other)}` : '';
  return `${letter} ${money(main)}${extra}`;
}

/**
 * Liquidaciones - Precios donde se liquidó mucho dinero en los últimos días, cerca del precio actual.
 * Pocas zonas, que cambian al avanzar la hora simulada y el precio. Solo usa lo que ya se conocía.
 */
class LiquidationsIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = 'Liquidaciones';
    this.height = 0; // Se dibuja sobre las velas, no ocupa panel propio
    this.enabled = false;
    this.config = cleanLiquidationsSettings({ ...defaultLiquidationsConfig(), ...loadLiquidationsSettings(symbol) });

    this.sources = []; // Fuentes del símbolo, en orden de prioridad, con su tramo
    this.bySource = new Map(); // id de la fuente → celdas ordenadas por known
    this.loadedFrom = null; // Celdas cargadas: known en (loadedFrom, loadedTo]
    this.loadedTo = null;
    this.loading = false;
    this.generation = 0; // Una respuesta de antes de retroceder ya no sirve
    this.lastRequestAt = -Infinity;
    this.retryAt = 0;
    this.error = null;

    this.zoneKey = null;
    this.zones = [];
    this.widthPrice = null;
    this.widthSource = null;
    this.binWidth = null;
    this.spanMs = null; // Largo del intervalo más reciente de una fuente con precio estimado
    this.cross = new CrossTracker();
    this.shown = []; // Zonas dibujadas en el último cuadro, con su lugar
  }

  async fetchData() {
    return null; // Pide sola la ventana de la hora simulada al dibujarse
  }

  render() {}

  updateConfig(config) {
    const lookbackChanged = config.lookbackDays !== undefined && config.lookbackDays !== this.config.lookbackDays;
    this.config = { ...this.config, ...config };
    if (lookbackChanged) this.loadedTo = null; // La ventana nueva se pide completa
    this.zoneKey = null;
    this.widthPrice = null;
  }

  _rewind(time) {
    for (const list of this.bySource.values()) list.length = knownAfter(list, time);
    this.loadedTo = time;
    this.generation += 1;
    this.loading = false;
    this.zoneKey = null;
    this.cross.reset(); // Lo que el precio hizo después de esta hora todavía no pasó
  }

  /** Mantiene cargado lo conocido en (time - ventana, time]. Nunca pide después de time */
  _sync(time) {
    if (!Number.isFinite(time)) return;
    if (this.loadedTo !== null && time < this.loadedTo) this._rewind(time);

    const now = performance.now();
    if (this.loading || now < this.retryAt) return;

    const lookback = this.config.lookbackDays * DAY_MS;
    const from = time - lookback;
    if (this.loadedTo === null || from < this.loadedFrom || time - this.loadedTo > lookback) {
      this._request(from - FETCH_PAD_MS, time, true);
      return;
    }
    this._trim(from);
    if (time <= this.loadedTo) return;

    // Ninguna fuente tiene datos en lo que falta: no hace falta preguntar
    if (!this.sources.some(source => source.first <= time && source.last > this.loadedTo)) {
      this.loadedTo = time;
      return;
    }
    // Un día solo se conoce al cerrar: con fuentes por día basta preguntar al pasar la medianoche
    const onlyDays = this.sources.every(source => source.kind === 'days');
    const due = onlyDays
      ? Math.floor(time / DAY_MS) > Math.floor(this.loadedTo / DAY_MS)
      : time - this.loadedTo >= ADVANCE_MS;
    if (due && now - this.lastRequestAt >= REQUEST_GAP_MS) this._request(this.loadedTo, time, false);
  }

  /** Suelta lo que ya salió de la ventana, una vez por semana simulada: una reproducción larga no llena la memoria */
  _trim(from) {
    const keepFrom = from - FETCH_PAD_MS;
    if (this.loadedFrom === null || keepFrom - this.loadedFrom < TRIM_EVERY_MS) return;
    for (const [id, list] of this.bySource) {
      const cut = knownAfter(list, keepFrom);
      if (cut > 0) this.bySource.set(id, list.slice(cut));
    }
    this.loadedFrom = keepFrom;
    this.zoneKey = null;
  }

  _request(start, end, full) {
    const generation = this.generation;
    this.loading = true;
    this.lastRequestAt = performance.now();
    const params = new URLSearchParams({
      start_timestamp: String(Math.floor(start)),
      end_timestamp: String(Math.floor(end)),
      known_until: String(Math.floor(end))
    });

    fetch(`${API_BASE_URL}/api/liquidations/${this.symbol}?${params}`)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(result => {
        if (generation !== this.generation) return;
        if (!result.success) throw new Error(result.message || 'respuesta sin datos');
        this._receive(result, start, end, full);
      })
      .catch(error => {
        if (generation !== this.generation) return;
        this.error = error.message;
        this.retryAt = performance.now() + RETRY_WAIT_MS;
      })
      .finally(() => {
        if (generation === this.generation) this.loading = false;
        this.requestRedraw?.();
      });
  }

  _receive(result, start, end, full) {
    this.sources = result.sources || [];
    const ids = this.sources.map(source => source.id);
    if (full) this.bySource = new Map();
    for (const [known, cellStart, cellEnd, low, high, long, short, source] of result.cells || []) {
      const id = ids[source];
      if (!id) continue;
      if (!this.bySource.has(id)) this.bySource.set(id, []);
      this.bySource.get(id).push({ known, start: cellStart, end: cellEnd, low, high, long, short });
    }
    if (full) this.loadedFrom = result.start ?? start;
    this.loadedTo = Math.min(end, result.known_until ?? end);
    this.error = null;
    this.zoneKey = null;
  }

  /** Zonas de todos los precios en la hora simulada, con la fuente que manda en esa hora */
  _zonesAt(time, price) {
    const lookback = this.config.lookbackDays * DAY_MS;
    const source = activeSource(this.sources, time, lookback, this.config.source);
    this.spanMs = null;
    if (!source) return { source: null, zones: [] };

    if (this.widthSource !== source.id || this.widthPrice === null || Math.abs(price / this.widthPrice - 1) > WIDTH_DRIFT) {
      this.widthPrice = price;
      this.widthSource = source.id;
      this.zoneKey = null;
    }
    this.binWidth = binWidthFor(this.widthPrice, this.config.binPct, source.cell_width || 0);

    const cells = this.bySource.get(source.id) || [];
    const [from, to] = windowRange(cells, time, lookback);
    // Con precio estimado, el largo del intervalo más reciente dice qué tan fino es el precio
    if (source.kind === 'spans' && to > from) this.spanMs = cells[to - 1].end - cells[to - 1].start;
    const key = `${source.id}|${from}|${to}|${cells.length}|${this.binWidth}`;
    if (key !== this.zoneKey) {
      this.zoneKey = key;
      this.zones = buildZones(cells, from, to, this.binWidth, this.config);
    }
    return { source, zones: this.zones };
  }

  /** Zonas dibujadas, para elegirlas como nivel: su lugar ya calculado en este cuadro */
  selectableLevels() {
    return this.shown.map(({ zone, left, right, top, bottom }) => {
      const kind = zone.side === 'long' ? 'Liquidaciones de largos' : 'Liquidaciones de cortos';
      return {
        id: `Liquidaciones|${kind}|${zone.peak.toFixed(2)}`,
        source: 'Liquidaciones',
        kind,
        price: zone.peak,
        low: zone.low,
        high: zone.high,
        time: zone.birth,
        left,
        right,
        top,
        bottom
      };
    });
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    this.shown = [];
    if (!this.enabled || !priceContext || !visibleCandles?.length) return;
    if (priceContext.requestRedraw) this.requestRedraw = priceContext.requestRedraw;

    const time = priceContext.knownUntil;
    const known = priceContext.knownCandles?.length ? priceContext.knownCandles : allCandles;
    const price = known?.[known.length - 1]?.close;
    this._sync(time);

    const { source, zones } = Number.isFinite(price) ? this._zonesAt(time, price) : { source: null, zones: [] };
    const picked = source ? pickZones(zones, price, this.config) : { zones: [] };
    for (const zone of picked.zones) zone.crossed = this.cross.crossed(zone, known);
    const blind = isBlind();

    ctx.save();
    const offscreen = this._drawZones(ctx, bounds, picked.zones, priceContext);
    if (this.config.showLabels) this._drawLabels(ctx, bounds, time, blind);
    if (this.config.showOffscreen) this._drawOffscreen(ctx, bounds, offscreen);
    this._drawStatus(ctx, bounds, time, source, blind, zones.length > 0 && picked.zones.length === 0, zones.length === 0);
    ctx.restore();
  }

  _drawZones(ctx, bounds, zones, { priceToY, timeToX }) {
    const { longColor, shortColor, maxOpacity } = this.config;
    const top = bounds.y;
    const bottom = bounds.y + bounds.height;
    const right = bounds.x + bounds.width;
    const offscreen = { above: [], below: [] };

    for (const zone of zones) {
      const yHigh = priceToY(zone.high);
      const yLow = priceToY(zone.low);
      if (yLow < top) {
        offscreen.above.push(zone);
        continue;
      }
      if (yHigh > bottom) {
        offscreen.below.push(zone);
        continue;
      }
      const born = timeToX(zone.birth);
      if (born !== null && born > right) continue; // Nació después de lo que está a la vista
      const left = Math.max(bounds.x, born ?? bounds.x);
      const y = Math.max(top, yHigh);
      const height = Math.max(2, Math.min(bottom, yLow) - y);
      const color = zone.side === 'long' ? longColor : shortColor;
      const alpha = (MIN_ALPHA + (maxOpacity - MIN_ALPHA) * Math.sqrt(zone.share)) * (zone.crossed ? CROSSED_DIM : 1);

      ctx.fillStyle = withOpacity(color, alpha);
      ctx.fillRect(left, y, right - left, height);

      // Línea en la franja con más dinero de la zona. Punteada si el precio ya la atravesó
      const peakY = Math.round(priceToY(zone.peak)) + 0.5;
      if (peakY >= top && peakY <= bottom) {
        ctx.strokeStyle = withOpacity(color, Math.min(0.9, alpha + (zone.crossed ? 0.25 : 0.4)));
        ctx.lineWidth = 1;
        ctx.setLineDash(zone.crossed ? [3, 3] : []);
        ctx.beginPath();
        ctx.moveTo(left, peakY);
        ctx.lineTo(right, peakY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      this.shown.push({ zone, left, right, top: y, bottom: y + height, peakY });
    }
    return offscreen;
  }

  _drawLabels(ctx, bounds, time, blind) {
    const placed = [];
    ctx.font = '10px Inter, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    // La zona más grande pone su etiqueta primero: si dos chocan, queda la suya
    for (const { zone, left, peakY } of [...this.shown].sort((a, b) => b.zone.total - a.zone.total)) {
      // Donde nace la zona; si nace cerca del borde derecho, a la izquierda: no tapa las últimas velas
      const x = left > bounds.x + bounds.width * LABEL_RIGHT_LIMIT ? bounds.x + 4 : left + 4;
      if (placed.some(other => Math.abs(other.y - peakY) < LABEL_GAP_PX && Math.abs(other.x - x) < 140)) continue;
      const text = `${zoneLabel(zone, blind)} · ${ageText(time - zone.birth)}${zone.crossed ? ' · cruzada' : ''}`;
      const width = ctx.measureText(text).width + 6;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillRect(x - 3, peakY - 7, width, 14);
      ctx.globalAlpha = zone.crossed ? 0.6 : 1;
      ctx.fillStyle = zone.side === 'long' ? this.config.longColor : this.config.shortColor;
      ctx.fillText(text, x, peakY);
      ctx.globalAlpha = 1;
      placed.push({ x, y: peakY });
    }
  }

  _drawOffscreen(ctx, bounds, { above, below }) {
    const right = bounds.x + bounds.width - 6;
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const tag = (zones, arrow, y) => {
      if (!zones.length) return;
      const nearest = zones.reduce((best, zone) => (Math.abs(zone.distancePct) < Math.abs(best.distancePct) ? zone : best));
      const text = `${arrow} ${zones.length === 1 ? '1 zona' : `${zones.length} zonas`} · ${Math.abs(nearest.distancePct).toFixed(1)}%`;
      const width = ctx.measureText(text).width + 8;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillRect(right - width + 4, y - 7, width, 14);
      ctx.fillStyle = nearest.side === 'long' ? this.config.longColor : this.config.shortColor;
      ctx.fillText(text, right, y);
    };
    tag(above, '▲', bounds.y + 10);
    tag(below, '▼', bounds.y + bounds.height - 10);
  }

  _drawStatus(ctx, bounds, time, source, blind, noneNear = false, empty = false) {
    const lookback = this.config.lookbackDays * DAY_MS;
    let text;
    if (this.error && !this.sources.length) {
      text = 'Liquidaciones: el backend no respondió, se reintenta';
    } else if (this.loadedTo === null && !this.sources.length) {
      text = 'Liquidaciones: cargando...';
    } else if (!this.sources.length) {
      text = 'Liquidaciones: no hay datos para este símbolo';
    } else if (!source) {
      const forced = this.sources.find(item => item.id === this.config.source);
      const head = forced ? `Liquidaciones: sin datos de ${forced.label} en esta fecha` : 'Liquidaciones: sin datos en esta fecha';
      const covered = (forced ? [forced] : this.sources).map(item => `${item.label} ${coverageText(item, 2)}`).join(' · ');
      text = blind ? head : `${head} · hay ${covered}`;
    } else {
      const notes = [];
      if (this.spanMs) notes.push(`intervalos de ${spanText(this.spanMs)}`);
      if (!blind && time - lookback < source.first) notes.push(`datos desde ${utcDate(source.first)}`);
      if (!blind && time > source.last) notes.push(`datos hasta ${utcDate(source.last - 1)}`);
      if (empty) notes.push('todavía sin liquidaciones conocidas');
      if (noneNear) notes.push(`ninguna zona a menos de ${this.config.maxDistancePct}%`);
      // Con fecha oculta no se nombra la fuente: cada una cubre una época
      const head = blind ? 'Liquidaciones' : `Liquidaciones · ${source.label}, ${source.scope}`;
      text = `${head} · ${this.config.lookbackDays} d${notes.length ? ` · ${notes.join(' · ')}` : ''}`;
    }

    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(text).width + 8;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(bounds.x + 2, bounds.y + 3, width, 14);
    ctx.fillStyle = '#6B7280';
    ctx.fillText(text, bounds.x + 6, bounds.y + 10);
  }
}

export default LiquidationsIndicator;
