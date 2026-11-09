import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';
import { isBlind } from '../backtesting/blindClock.js';
import { TF_MS } from '../backtesting/replayClock.js';
import { candleItemId } from './analysisLevels.js';
import { pinnedAt, pinsAt, togglePin } from './liquidationPins.js';
import { alignY, crispWidth } from '../chartPixels.js';
import { THEME, chartInk } from '../uiTheme.js'; // Etiquetas con el fondo del gráfico; con Oscuro, texto aclarado
import {
  CrossTracker, DAY_MS, PINNED_KIND, PIN_KINDS, activeSource, binWidthFor, buildZones, coverageText, defaultPickRules, defaultZoneRules,
  knownAfter, money, pickZones, pinEdge, pinRange, pinSummary, windowRange
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
const MIN_TIP_BAR_PX = 4; // Con velas más angostas no se ofrecen sus máximos y mínimos: no se alcanzan a elegir
const TIP_HALF_PX = 4; // Alto que alcanza un clic sobre la punta de una vela
const PIN_PAD_PCT = 0.1; // Margen de la vela fijada por redondeo de precios: por fuera, y lo mínimo hacia adentro

// Lo que el modal deja cambiar. Las reglas internas de las zonas (maxHalfBins, halfFraction) no se guardan:
// así un cambio de sus valores de fábrica llega también a quien ya guardó parámetros
const USER_KEYS = [
  'lookbackDays', 'binPct', 'perSide', 'maxDistancePct', 'minShare', 'minGapPct', 'showLongs', 'showShorts', 'source',
  'longColor', 'shortColor', 'maxOpacity', 'showLabels', 'showOffscreen', 'showPins', 'offerCandles', 'pinColor', 'pinWickMaxPct'
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
    showOffscreen: true, // Aviso de zonas elegidas que quedan arriba o abajo de la vista
    showPins: true, // Franjas de las velas fijadas en el gráfico, aunque sean de hace meses
    offerCandles: true, // Un clic en el máximo o el mínimo de una vela la ofrece en el menú de niveles
    pinColor: '#F59E0B', // Velas elegidas: otro color que las zonas cerca del precio
    pinWickMaxPct: 0.5 // Una vela fijada cuenta su mecha hasta este alto, como % del precio
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
  maxOpacity: [0.05, 0.8],
  pinWickMaxPct: [0.1, 5]
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
  for (const key of ['showLongs', 'showShorts', 'showLabels', 'showOffscreen', 'showPins', 'offerCandles']) clean[key] = !!clean[key];
  for (const key of ['longColor', 'shortColor', 'pinColor']) if (!/^#[0-9a-fA-F]{6}$/.test(clean[key])) clean[key] = defaults[key];
  return clean;
}

/** Montos de una vela fijada: los dos lados, o con fecha oculta la parte de cada uno */
export function pinAmounts(summary, blind = false) {
  if (!(summary.total > 0)) return 'sin liquidaciones';
  if (blind) return `C ${Math.round(summary.short / summary.total * 100)}% · L ${Math.round(summary.long / summary.total * 100)}%`;
  const parts = [];
  if (summary.short > 0) parts.push(`C ${money(summary.short)}`);
  if (summary.long > 0) parts.push(`L ${money(summary.long)}`);
  return parts.join(' + ');
}

function withOpacity(hex, opacity) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
}

/** Altura de una etiqueta dentro del área de precio: en un borde quedaría cortada, y arriba está la línea de estado */
const labelInside = (y, bounds) => Math.min(bounds.y + bounds.height - 8, Math.max(bounds.y + 25, y));

/** El mismo color más oscuro, para que el texto se lea sobre fondo blanco */
function darken(hex, factor) {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift) => Math.round(((value >> shift) & 255) * factor);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
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
    this.lastTime = null;
    this.shown = []; // Zonas dibujadas en el último cuadro, con su lugar
    this.pins = new Map(); // id de la vela fijada → celdas de su vela, pedidas aparte porque puede ser de hace meses
    this.candleTargets = []; // Máximos y mínimos de las velas a la vista, para fijarlos con un clic
    this.pinTargets = []; // Franjas de las velas fijadas a la vista, para incluirlas en el análisis de un trade
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

  /** Celdas de una vela fijada, conocidas en la hora simulada. Se piden aparte y se completan si faltaba algo */
  _pinCells(item, time) {
    const frameMs = TF_MS[item.timeframe] || TF_MS[this.interval] || 0;
    // Los días de MarginPad y los intervalos de Coinalyze van alineados a la medianoche UTC: lo que se cruza con la
    // vela se conoce a más tardar al cerrar el día en que termina la vela. Un evento, en su hora
    const reach = Math.ceil((item.time + frameMs) / DAY_MS) * DAY_MS;
    let entry = this.pins.get(item.id);
    if (!entry) {
      entry = { cells: [], sources: [], cut: null, loading: false, generation: 0, lastRequestAt: -Infinity, retryAt: 0, key: null, summary: null };
      this.pins.set(item.id, entry);
    }
    if (entry.cut !== null && time < entry.cut) {
      // Al retroceder, lo conocido después todavía no se sabía
      entry.cells = entry.cells.filter(cell => cell.known <= time);
      entry.cut = time;
      entry.generation += 1;
      entry.loading = false;
      entry.key = null;
    }
    const now = performance.now();
    const due = entry.cut === null || (entry.cut < reach && time - entry.cut >= ADVANCE_MS);
    if (due && !entry.loading && now >= entry.retryAt && now - entry.lastRequestAt >= REQUEST_GAP_MS) {
      this._pinRequest(item.id, entry, item.time - 1, Math.min(reach, time));
    }
    return { entry, frameMs, reach };
  }

  _pinRequest(id, entry, start, cut) {
    const generation = entry.generation;
    entry.loading = true;
    entry.lastRequestAt = performance.now();
    const params = new URLSearchParams({
      start_timestamp: String(Math.floor(start)),
      end_timestamp: String(Math.floor(cut)),
      known_until: String(Math.floor(cut))
    });
    fetch(`${API_BASE_URL}/api/liquidations/${this.symbol}?${params}`)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(result => {
        if (generation !== entry.generation || this.pins.get(id) !== entry) return;
        if (!result.success) throw new Error(result.message || 'respuesta sin datos');
        entry.sources = result.sources || [];
        const ids = entry.sources.map(source => source.id);
        entry.cells = (result.cells || []).map(([known, cellStart, cellEnd, low, high, long, short, source]) => (
          { known, start: cellStart, end: cellEnd, low, high, long, short, source: ids[source] }
        ));
        entry.cut = Math.min(cut, result.known_until ?? cut);
        entry.key = null;
        entry.error = null;
      })
      .catch(error => {
        if (generation !== entry.generation) return;
        entry.error = error.message;
        entry.retryAt = performance.now() + RETRY_WAIT_MS;
      })
      .finally(() => {
        if (generation === entry.generation) entry.loading = false;
        this.requestRedraw?.();
      });
  }

  /** Precios de una vela fijada: su mecha, sin pasar del alto máximo del modal */
  _pinRange(item) {
    const pin = { edge: pinEdge(item), high: item.high ?? item.price, low: item.low ?? item.price, open: item.open, close: item.close };
    return pinRange(pin, this.config.pinWickMaxPct, PIN_PAD_PCT);
  }

  /** Liquidaciones de una vela fijada en sus precios, con la fuente que cubre la fecha de esa vela (no la de hoy) */
  _pinState(item, time, range) {
    const { entry, frameMs, reach } = this._pinCells(item, time);
    if (entry.cut === null) return { loading: true, error: entry.error };
    const source = activeSource(entry.sources, item.time, this.config.lookbackDays * DAY_MS, this.config.source);
    if (!source) return { source: null };
    const key = `${source.id}|${entry.cut}|${entry.cells.length}|${range.low}|${range.high}`;
    if (entry.key !== key) {
      entry.summary = pinSummary(entry.cells.filter(cell => cell.source === source.id), { time: item.time }, frameMs, range);
      entry.key = key;
    }
    // Con datos por día o por intervalo, una celda que se cruza con la vela puede cerrar después de la hora simulada
    const partial = source.kind !== 'events' && time < reach && entry.cut < reach;
    return { source, summary: entry.summary, partial, frameMs };
  }

  /** Zonas dibujadas, para elegirlas como nivel: su lugar ya calculado en este cuadro */
  selectableLevels() {
    const zones = this.shown.map(({ zone, left, right, top, bottom }) => {
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
    return [...zones, ...this.pinTargets, ...this.candleTargets];
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    this.shown = [];
    this.candleTargets = [];
    this.pinTargets = [];
    if (!this.enabled || !priceContext || !visibleCandles?.length) return;
    if (priceContext.requestRedraw) this.requestRedraw = priceContext.requestRedraw;

    const time = priceContext.knownUntil;
    const known = priceContext.knownCandles?.length ? priceContext.knownCandles : allCandles;
    const price = known?.[known.length - 1]?.close;
    if (this.lastTime !== null && time < this.lastTime) this.cross.reset(); // Lo que el precio hizo después todavía no pasó
    this.lastTime = time;
    this._sync(time);

    const { source, zones } = Number.isFinite(price) ? this._zonesAt(time, price) : { source: null, zones: [] };
    const picked = source ? pickZones(zones, price, this.config) : { zones: [] };
    for (const zone of picked.zones) zone.crossed = this.cross.crossed(zone, known);
    const blind = isBlind();

    ctx.save();
    const offscreen = this._drawZones(ctx, bounds, picked.zones, priceContext);
    if (this.config.showLabels) this._drawLabels(ctx, bounds, time, blind);
    if (this.config.showOffscreen) this._drawOffscreen(ctx, bounds, offscreen);
    if (this.config.showPins) this._drawPins(ctx, bounds, time, priceContext, known, blind);
    this._drawStatus(ctx, bounds, time, source, blind, zones.length > 0 && picked.zones.length === 0, zones.length === 0);
    ctx.restore();
    if (this.config.offerCandles) this._offerCandles(visibleCandles, bounds, priceContext);
  }

  /**
   * Máximo y mínimo de cada vela cerrada a la vista, para fijarlos con un clic. No dibuja nada.
   * Traen su propia lista (choice): el menú de niveles las fija o las suelta en liquidationPins.js, sin pasar por
   * lo elegido para el trade, que se vacía con cada orden
   */
  _offerCandles(visibleCandles, bounds, { priceToY, timeToX }) {
    const barWidth = bounds.width / visibleCandles.length;
    if (barWidth < MIN_TIP_BAR_PX) return;
    const half = Math.max(3, barWidth / 2);
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;
    const symbol = this.symbol;
    for (const candle of visibleCandles) {
      if (candle.in_progress) continue; // Su máximo y su mínimo todavía pueden cambiar
      const x = timeToX(candle.timestamp);
      if (x === null || x < bounds.x || x > right) continue;
      for (const edge of ['high', 'low']) {
        const price = candle[edge];
        const y = priceToY(price);
        if (y < bounds.y || y > bottom) continue;
        const kind = PIN_KINDS[edge];
        const target = {
          id: candleItemId('Liquidaciones', kind, candle.timestamp, price, this.interval),
          source: 'Liquidaciones',
          kind,
          edge,
          price,
          time: candle.timestamp,
          low: candle.low,
          high: candle.high,
          open: candle.open, // El cuerpo dice dónde termina la mecha
          close: candle.close,
          left: x - half,
          right: x + half,
          top: y - TIP_HALF_PX,
          bottom: y + TIP_HALF_PX
        };
        target.choice = {
          chosen: (time) => pinnedAt(symbol, target.id, time),
          toggle: (time, timeframe) => togglePin(symbol, target, time, timeframe)
        };
        this.candleTargets.push(target);
      }
    }
  }

  /** Texto de una vela fijada: marco, fuente, montos, rango de precios contado y qué tan fino es el dato */
  _pinLabel(item, state, blind, crossed, range) {
    const head = `Vela ${item.timeframe || this.interval}`;
    if (state.loading) return `${head}: ${state.error ? 'el backend no respondió' : 'cargando...'}`;
    if (!state.source) return `${head}: sin datos de liquidaciones en su fecha`;
    const parts = [`${head}${blind ? '' : ` · ${state.source.label}`}: ${pinAmounts(state.summary, blind)}`];
    // Lo contado hacia adentro desde el extremo; "tope" si la mecha era más larga que el alto máximo del modal
    parts.push(`rango ${(range.depth / range.price * 100).toFixed(2)}%${range.capped ? ' (tope)' : ''}`);
    if (state.summary.spanMs > state.frameMs) parts.push(`dato de ${spanText(state.summary.spanMs)}`);
    if (state.partial) parts.push('parcial');
    if (crossed) parts.push('cruzada');
    return parts.join(' · ');
  }

  /**
   * Velas fijadas en el gráfico (desde el menú de niveles): una franja en los precios de su mecha (pinRange), desde
   * esa vela hasta el borde derecho, con lo liquidado ahí. Otro color que las zonas cerca del precio.
   * La franja se ofrece al Observador para incluirla en el análisis de un trade; la vela sigue fijada después
   */
  _drawPins(ctx, bounds, time, { priceToY, timeToX }, known, blind) {
    const items = pinsAt(this.symbol, time).filter(item => pinEdge(item) && Number.isFinite(item.price) && Number.isFinite(item.time));
    if (!items.length) return;
    const color = this.config.pinColor;
    const top = bounds.y;
    const bottom = bounds.y + bounds.height;
    const right = bounds.x + bounds.width;
    ctx.font = '10px Inter, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    for (const item of items) {
      const range = this._pinRange(item);
      const state = this._pinState(item, time, range);
      const frameMs = TF_MS[item.timeframe] || TF_MS[this.interval] || 0;
      const zone = { birth: item.time + frameMs, low: range.low, high: range.high };
      const yTop = priceToY(zone.high);
      const yBottom = priceToY(zone.low);
      if (yBottom < top || yTop > bottom) continue;
      const born = timeToX(item.time);
      if (born !== null && born > right) continue; // La vela está después de lo que se ve
      const left = Math.max(bounds.x, born ?? bounds.x);
      const crossed = this.cross.crossed(zone, known);
      const alpha = this.config.maxOpacity * 0.8 * (crossed ? CROSSED_DIM : 1);

      const y = Math.max(top, yTop);
      const height = Math.max(3, Math.min(bottom, yBottom) - y);
      ctx.fillStyle = withOpacity(color, alpha);
      ctx.fillRect(left, y, right - left, height);
      this.pinTargets.push({
        id: `Liquidaciones|${PINNED_KIND}|${item.id}`,
        source: 'Liquidaciones',
        kind: PINNED_KIND,
        price: item.price,
        time: item.time,
        low: zone.low,
        high: zone.high,
        left,
        right,
        top: y,
        bottom: y + height
      });
      const lineY = alignY(priceToY(item.price), 1.5); // Entera en píxeles reales, en cualquier pantalla
      ctx.strokeStyle = withOpacity(color, Math.min(0.95, alpha + 0.5));
      ctx.lineWidth = crispWidth(1.5);
      ctx.setLineDash(crossed ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(left, lineY);
      ctx.lineTo(right, lineY);
      ctx.stroke();
      ctx.setLineDash([]);

      if (!this.config.showLabels) continue;
      const text = this._pinLabel(item, state, blind, crossed, range);
      const x = left > bounds.x + bounds.width * LABEL_RIGHT_LIMIT ? bounds.x + 4 : left + 4;
      const labelY = labelInside(lineY, bounds);
      const width = ctx.measureText(text).width + 6;
      ctx.fillStyle = THEME.labelBg;
      ctx.fillRect(x - 3, labelY - 7, width, 14);
      ctx.globalAlpha = crossed ? 0.65 : 1;
      ctx.fillStyle = THEME.dark ? chartInk(color) : darken(color, 0.65);
      ctx.fillText(text, x, labelY);
      ctx.globalAlpha = 1;
    }
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
      const peakY = alignY(priceToY(zone.peak), 1); // Entera en píxeles reales, en cualquier pantalla
      if (peakY >= top && peakY <= bottom) {
        ctx.strokeStyle = withOpacity(color, Math.min(0.9, alpha + (zone.crossed ? 0.25 : 0.4)));
        ctx.lineWidth = crispWidth(1);
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
      const labelY = labelInside(peakY, bounds);
      if (placed.some(other => Math.abs(other.y - labelY) < LABEL_GAP_PX && Math.abs(other.x - x) < 140)) continue;
      const text = `${zoneLabel(zone, blind)} · ${ageText(time - zone.birth)}${zone.crossed ? ' · cruzada' : ''}`;
      const width = ctx.measureText(text).width + 6;
      ctx.fillStyle = THEME.labelBg;
      ctx.fillRect(x - 3, labelY - 7, width, 14);
      ctx.globalAlpha = zone.crossed ? 0.6 : 1;
      ctx.fillStyle = chartInk(zone.side === 'long' ? this.config.longColor : this.config.shortColor);
      ctx.fillText(text, x, labelY);
      ctx.globalAlpha = 1;
      placed.push({ x, y: labelY });
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
      ctx.fillStyle = THEME.labelBg;
      ctx.fillRect(right - width + 4, y - 7, width, 14);
      ctx.fillStyle = chartInk(nearest.side === 'long' ? this.config.longColor : this.config.shortColor);
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
    ctx.fillStyle = THEME.labelBg;
    ctx.fillRect(bounds.x + 2, bounds.y + 3, width, 14);
    ctx.fillStyle = THEME.dark ? THEME.textMuted : '#6B7280';
    ctx.fillText(text, bounds.x + 6, bounds.y + 10);
  }
}

export default LiquidationsIndicator;
