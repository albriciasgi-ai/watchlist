import React, { useCallback, useEffect, useState } from 'react';
import { getJson, postJson } from './api.js';

/**
 * Panel del scanner en la Watchlist (22/11/2026, docs/PLAN_SCANNER.md, paso 1): el estado del mercado, las listas con su
 * regla y el porqué de cada moneda, su detalle y los ajustes. El scanner vive en el servidor (server/scanner.py); aquí solo
 * se lee y se cambia su configuración. Nada se envía al bot, y una moneda se graba solo con «Agregar a la suite».
 */
export const LIST_TABS = [['enjuego', 'En juego'], ['tendencia', 'Tendencia'], ['rapidos', 'Rápidos'], ['mias', 'Mis monedas']];
export const GRID_LISTS = LIST_TABS.slice(0, 3);
export const LIST_SHORT = Object.fromEntries(LIST_TABS);
export const GRID_COUNTS = [6, 9, 12, 16, 20];
const GROUPS = [['cripto', 'Cripto'], ['innovacion', 'Innovación'], ['acciones', 'Acciones'], ['etf', 'ETF'],
  ['materias', 'Materias primas'], ['forex', 'Forex']];
const GROUP_NAME = Object.fromEntries(GROUPS);

const ok = (x) => x != null && Number.isFinite(x);
export const pct = (x, digits = 1) => (ok(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(digits)}%` : '—');
const plain = (x, digits = 1) => (ok(x) ? `${(x * 100).toFixed(digits)}%` : '—');
const num = (x, digits = 2) => (ok(x) ? x.toFixed(digits) : '—');
const times = (x) => (ok(x) ? `×${x.toFixed(1)}` : '—');
const share = (x) => (ok(x) ? `${Math.round(x * 100)}%` : '—');
const usd = (x) => (!ok(x) ? '—' : x >= 1e9 ? `${(x / 1e9).toFixed(2)} B` : x >= 1e6 ? `${(x / 1e6).toFixed(1)} M` : `${Math.round(x / 1e3)} mil`);
const short = (sym) => sym.replace(/USDT$/, '');
export function priceText(p) {
  if (!ok(p)) return '—';
  if (p >= 1000) return p.toFixed(1);
  if (p >= 10) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toPrecision(4);
}
const colombiaTime = (ms) => new Date(ms).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false });
const ago = (ms) => {
  if (!ms) return '—';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 90 ? `hace ${s} s` : `hace ${Math.round(s / 60)} min`;
};
/** El costo en R con color: hasta 0.10 R, verde; más de 0.20 R, rojo. El asterisco: estimado con el spread, sin libro */
export function costClass(r) {
  if (!ok(r)) return '';
  return r <= 0.1 ? 'pos' : r > 0.2 ? 'neg' : '';
}
const costText = (row) => (ok(row?.cost_r_1h) ? `${row.cost_r_1h.toFixed(2)}${row.cost_estimated ? '*' : ''}` : '—');

function MarketSection({ market }) {
  if (!market) {
    return (
      <div className="bot-section">
        <h3>Estado del mercado</h3>
        <div className="bot-empty">Todavía sin la primera vuelta del scanner.</div>
      </div>
    );
  }
  const b = market.btc || {};
  const t = market.thresholds || {};
  const where = b.above_ma20 == null ? '' : b.above_ma20 ? ' · sobre su promedio de 20 días' : ' · bajo su promedio de 20 días';
  return (
    <div className="bot-section">
      <h3>Estado del mercado</h3>
      <div className="wl-row">BTC {pct(b.ret_24h)} en 24 h · {pct(b.ret_7d)} en 7 días{where}</div>
      <div className="wl-row wl-muted" title="El ATR diario de BTC contra el de su último año">
        ATR diario {plain(b.atr_d)}{ok(b.atr_d_pctile_1y) ? ` (más alto que el ${Math.round(b.atr_d_pctile_1y * 100)}% de su año)` : ''} · eficiencia de 7 días {num(b.er_7d)}
      </div>
      <div className="wl-row">Amplitud: {share(market.breadth_ma20)} sobre su promedio de 20 días · {share(market.breadth_up24)} suben en 24 h</div>
      <div className="wl-row" title="Dispersión: rango intercuartil de los retornos de 24 h entre las monedas, en puntos">
        Dispersión de 24 h: {num(market.dispersion_iqr24, 1)} puntos · correlación con BTC {num(market.corr_7d)} (7 d), {num(market.corr_30d)} (30 d)
      </div>
      <div className="wl-row">Mejor que BTC en 7 días (movimiento propio): {share(market.alts_vs_btc7)}</div>
      <div className="wl-row" title="Funding ponderado por el OI de cada moneda, llevado a 8 h; y el cambio del OI en 24 h, ponderado igual">
        Funding medio {pct(market.funding_8h, 3)} por 8 h · OI de 24 h {pct(market.oi_24h)}
      </div>
      <div className="wl-row wl-muted">
        Volumen relativo mediano {num(market.rvol_24h)} · {market.session}{market.weekend ? ' · fin de semana' : ''} · {market.coins} monedas
      </div>
      <div className="wl-row" title={`En bloque: correlación de 7 días de ${t.block_corr} o más y dispersión de ${t.block_disp} puntos o menos. Cada una por su lado: correlación bajo ${t.own_corr} o dispersión de ${t.own_disp} o más. Es una hipótesis del plan: el registro dirá si sirve.`}>
        <span><b>Lectura: {market.reading}.</b> {market.hint}</span>
      </div>
    </div>
  );
}

function Chips({ row, max = 4 }) {
  const chips = (row.chips || []).filter(c => !/ R\*?$/.test(c.text)).slice(0, max);
  return (
    <>
      {chips.map(c => <span key={c.text} className="wl-chip" title={c.title}>{c.text}</span>)}
      {(row.flags || []).length > 0 && (
        <span className="wl-chip warn" title={row.flags.map(f => f.text).join('\n')}>{row.flags.length === 1 ? '1 aviso' : `${row.flags.length} avisos`}</span>
      )}
    </>
  );
}

function DetailRow({ label, children, title }) {
  return (
    <tr title={title}>
      <td className="wl-kv-label">{label}</td>
      <td className="wl-kv-value">{children}</td>
    </tr>
  );
}

function CoinDetail({ symbol, data, error, config, inBot, inSuite, pinned, onTogglePin, onAdd, adding, onOpenChart, gridTf }) {
  if (error) return <div className="suite-result bad">{error}</div>;
  if (!data) return <div className="bot-empty">Cargando {short(symbol)}…</div>;
  const r = data.row || {};
  const book = r.book;
  const age = ok(r.age_days) ? ` · listada hace ${Math.round(r.age_days)} días` : '';
  const size = config?.size_usdt;
  return (
    <div className="wl-detail">
      <div className="wl-row">
        <b>{short(symbol)}</b>
        <span className="wl-muted">{GROUP_NAME[r.group] || r.group}{r.st ? ' · ST' : ''}{age}</span>
      </div>
      {r.pending ? <div className="wl-row wl-muted">Todavía sin medidas: no es candidata o el scanner la está armando.</div> : null}
      {(r.flags || []).map(f => <div key={f.code} className="wl-row neg wl-flag">{f.text}</div>)}
      <table className="bot-table wl-kv">
        <tbody>
          <DetailRow label="Precio">{priceText(r.price)} · {usd(r.turnover24h)} USD en 24 h{r.turnover_rank ? ` · puesto ${r.turnover_rank}` : ''}</DetailRow>
          <DetailRow label="Volumen relativo" title={r.rvol_base === 'todos' ? 'Contra todos los días: no hay suficientes del mismo tipo' : 'Contra la misma hora de días del mismo tipo (entre semana o fin de semana)'}>
            1 h {times(r.rvol_1h)} · 4 h {times(r.rvol_4h)} · 24 h {times(r.rvol_24h)}{r.rvol_base === 'todos' ? ' (todos los días)' : ''}
          </DetailRow>
          <DetailRow label="Retorno">1 h {pct(r.ret_1h)} · 24 h {pct(r.ret_24h)} · 7 d {pct(r.ret_7d)}</DetailRow>
          <DetailRow label="Propio vs BTC" title="El retorno menos beta × el de BTC (beta y correlación de 30 días con retornos de 1 h)">
            24 h {pct(r.resid_24h)} · 7 d {pct(r.resid_7d)} · beta {num(r.beta_30d)} · corr. {num(r.corr_30d)}
          </DetailRow>
          <DetailRow label="Volatilidad" title="ATR de 14 velas en % del precio; expansión: el rango de las últimas 24 h contra su mediana de 30 días">
            ATR 1 h {plain(r.atr_1h, 2)} · 4 h {plain(r.atr_4h, 2)} · día {plain(r.atr_d, 1)} · {times(r.vol_exp)}
          </DetailRow>
          <DetailRow label="Tendencia" title="Eficiencia: recorrido neto de 7 días ÷ el camino recorrido. Rango: dónde está el precio entre el mínimo y el máximo de 30 días">
            eficiencia {num(r.er_7d)} · rango 30 d {share(r.range_30d)}{r.break20 > 0 ? ' · rompe el máximo de 20 d' : r.break20 < 0 ? ' · rompe el mínimo de 20 d' : ''}
          </DetailRow>
          <DetailRow label="OI">1 h {pct(r.oi_1h)} · 4 h {pct(r.oi_4h)} · 24 h {pct(r.oi_24h)}{r.oi_quadrant ? ` · ${r.oi_quadrant}` : ''}</DetailRow>
          <DetailRow label="Funding" title={`Liquida cada ${Math.round((r.funding_min || 480) / 60)} h`}>
            {pct(r.funding_8h, 3)} por 8 h · {ok(r.funding_day) ? (r.funding_day >= 0 ? `el largo paga ${plain(r.funding_day, 3)} por día` : `el corto paga ${plain(-r.funding_day, 3)} por día`) : '—'}
          </DetailRow>
          <DetailRow label="Costo" title={`Comisión taker de ida y vuelta, spread y deslizamiento de una orden a mercado de ${size?.toLocaleString('en-US')} USDT. Con entrada limit, la comisión de entrada es maker y no hay deslizamiento al entrar`}>
            {ok(r.cost_rt_bps) ? `${r.cost_rt_bps.toFixed(1)} bps a mercado · ${num(r.cost_limit_bps, 1)} con entrada limit${r.cost_estimated ? ' (estimado, sin libro)' : ''}` : '—'}
          </DetailRow>
          <DetailRow label="Costo en R" title={`En R de un stop de ${config?.stop_atr1h} ATR de 1 h y de ${config?.stop_atr4h} ATR de 4 h`}>
            <span className={costClass(r.cost_r_1h)}>{num(r.cost_r_1h)} R</span> ({config?.stop_atr1h} ATR 1 h) · <span className={costClass(r.cost_r_4h)}>{num(r.cost_r_4h)} R</span> ({config?.stop_atr4h} ATR 4 h)
          </DetailRow>
          <DetailRow label="Libro" title="Deslizamiento desde el precio medio, con la mitad del spread, de una orden a mercado de tu tamaño">
            {book ? `spread ${num(book.spread_bps, 1)} bps · compra ${num(book.buy_bps, 1)} · venta ${num(book.sell_bps, 1)} bps (${book.levels} niveles, ${ago(book.at)})` : ok(r.spread_bps) ? `spread mediano ${num(r.spread_bps, 1)} bps (sin libro todavía)` : '—'}
          </DetailRow>
          <DetailRow label="En la suite">{inSuite ? 'sí: se graba su libro y su cinta' : 'no: solo velas de Bybit'}</DetailRow>
          <DetailRow label="En el bot">{inBot == null ? 'el bot no responde' : inBot ? 'configurada' : 'no configurada (Bot > Configuración)'}</DetailRow>
        </tbody>
      </table>
      <div className="wl-row wl-actions">
        <button type="button" className="suite-btn" onClick={() => onOpenChart(symbol, gridTf)}>Abrir en el gráfico</button>
        <button type="button" className="suite-btn" onClick={() => onTogglePin(symbol)}>{pinned ? 'Soltar de la cuadrícula' : 'Fijar en la cuadrícula'}</button>
        {!inSuite && SUITE_SYMBOL.test(symbol) && (
          <button type="button" className="suite-btn" disabled={adding} onClick={() => onAdd(symbol)}
                  title="La suma a las monedas de la suite: desde ahí se graban su libro, su cinta y Hyperliquid">
            Agregar a la suite
          </button>
        )}
      </div>
      {!inSuite && !SUITE_SYMBOL.test(symbol) && (
        <div className="wl-row wl-muted">La suite todavía no acepta monedas de una sola letra: se mira aquí, pero no se puede agregar.</div>
      )}
    </div>
  );
}
// Las monedas que acepta la suite (symbols.py): de 2 a 20 letras o números antes de USDT
const SUITE_SYMBOL = /^[A-Z0-9]{2,20}USDT$/;

const FIELD_NAMES = {
  size_usdt: 'El tamaño de orden (USDT)', floor_usd: 'El piso de liquidez (en USD)', rvol24_min: 'El volumen relativo de 24 h',
  rvol1h_min: 'El volumen relativo de 1 h', book_max_bps: 'El libro suficiente (bps)', hold_min: 'Los minutos antes de salir',
  groups: 'Los grupos',
};

function ConfigSection({ config, onSaved }) {
  const [form, setForm] = useState(null);
  const [state, setState] = useState({ saving: false, error: null, done: false });
  useEffect(() => {
    if (!config) return;
    setForm({
      size_usdt: String(config.size_usdt), floor_m: String(config.floor_usd / 1e6), groups: [...config.groups],
      allow_st: config.allow_st, rvol24_min: String(config.rvol24_min), rvol1h_min: String(config.rvol1h_min),
      book_max_bps: String(config.book_max_bps), hold_min: String(config.hold_min),
    });
  }, [config]);
  if (!form) return null;
  const set = (key, value) => { setForm(f => ({ ...f, [key]: value })); setState(s => ({ ...s, done: false })); };
  const toggleGroup = (g) => set('groups', form.groups.includes(g) ? form.groups.filter(x => x !== g) : [...form.groups, g]);
  const save = async () => {
    const body = {
      size_usdt: Number(form.size_usdt), floor_usd: Number(form.floor_m) * 1e6, groups: form.groups, allow_st: form.allow_st,
      rvol24_min: Number(form.rvol24_min), rvol1h_min: Number(form.rvol1h_min), book_max_bps: Number(form.book_max_bps),
      hold_min: Number(form.hold_min),
    };
    setState({ saving: true, error: null, done: false });
    try {
      await postJson('/api/scanner/config', body);
      setState({ saving: false, error: null, done: true });
      onSaved();
    } catch (e) {
      // El servidor nombra el campo por su clave: aquí va con el nombre que se ve en el formulario
      const text = Object.entries(FIELD_NAMES).reduce((msg, [key, name]) => msg.replace(key, name), e.message || '');
      setState({ saving: false, error: text, done: false });
    }
  };
  const field = (key, label, title) => (
    <label className="wl-field" title={title}>
      <span>{label}</span>
      <input className="wl-input" value={form[key]} onChange={(e) => set(key, e.target.value)} />
    </label>
  );
  return (
    <details className="bot-section wl-config">
      <summary>Ajustes del scanner</summary>
      {field('size_usdt', 'Tamaño de orden (USDT)', 'Para el deslizamiento y el costo en R')}
      {field('floor_m', 'Piso de liquidez (M USD por día)', 'Turnover de 24 h que tiene que pasar una moneda para ser candidata')}
      {field('rvol24_min', 'Volumen relativo de 24 h mínimo', 'Para la lista «En juego»')}
      {field('rvol1h_min', 'Volumen relativo de 1 h mínimo', 'O este, en la última hora')}
      {field('book_max_bps', 'Libro suficiente: hasta (bps)', 'Spread y deslizamiento de ida y vuelta para tu tamaño')}
      {field('hold_min', 'Minutos antes de salir de una lista', 'Una moneda que deja de cumplir su regla sigue este tiempo, marcada; si ya no se puede operar, sale en el acto')}
      <div className="wl-row">Grupos que mira</div>
      <div className="wl-coins">
        {GROUPS.map(([g, label]) => (
          <label key={g} className="wl-coin">
            <input type="checkbox" checked={form.groups.includes(g)} disabled={form.groups.length === 1 && form.groups.includes(g)} onChange={() => toggleGroup(g)} />
            {label}
          </label>
        ))}
      </div>
      <label className="wl-row" title="La etiqueta ST de Bybit marca monedas de riesgo">
        <input type="checkbox" checked={form.allow_st} onChange={(e) => set('allow_st', e.target.checked)} /> Incluir las que Bybit marca ST
      </label>
      <div className="wl-row">
        <button type="button" className="suite-btn" disabled={state.saving} onClick={save}>Guardar</button>
        {state.done && <span className="pos">Guardado</span>}
      </div>
      {state.error && <div className="suite-result bad">{state.error}</div>}
    </details>
  );
}

export default function ScannerPanel({
  active, scan, panelList, onPanelList, source, onSource, gridList, onGridList, count, onCount, pins, onTogglePin,
  suiteSymbols, onSymbolsAdded, onOpenChart, gridTf, onRefresh, onHide,
}) {
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState({ symbol: null, data: null, error: null });
  const [events, setEvents] = useState([]);
  const [botCoins, setBotCoins] = useState(undefined);
  const [config, setConfig] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);
  const status = scan.status;

  const readConfig = useCallback(() => getJson('/api/scanner/config').then(d => setConfig(d.config)).catch(() => {}), []);
  useEffect(() => { if (active) readConfig(); }, [active, readConfig]);
  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    const read = () => {
      getJson('/api/scanner/events?limit=15').then(d => alive && setEvents(d.events || [])).catch(() => {});
      getJson('/api/bot/config').then(d => alive && setBotCoins(new Set((d.coins || []).map(c => c.symbol)))).catch(() => alive && setBotCoins(null));
    };
    read();
    const timer = setInterval(read, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, [active]);
  // El detalle de la moneda elegida: al elegirla y cada 30 s (el servidor trae su libro al día)
  useEffect(() => {
    if (!active || !selected) return undefined;
    let alive = true;
    const read = () => getJson(`/api/scanner/coin/${selected}`)
      .then(d => alive && setDetail({ symbol: selected, data: d, error: null }))
      .catch(e => alive && setDetail({ symbol: selected, data: null, error: e.message }));
    setDetail(d => (d.symbol === selected ? d : { symbol: selected, data: null, error: null }));
    read();
    const timer = setInterval(read, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, [active, selected]);

  const toggleScanner = async () => {
    setToggling(true);
    try {
      await postJson('/api/scanner/config', { enabled: !(config?.enabled ?? status?.enabled) });
      await readConfig();
      onRefresh();
    } catch {
      // el estado de abajo dice lo que pasó
    } finally {
      setToggling(false);
    }
  };
  const addToSuite = async (sym) => {
    if (!window.confirm(`¿Agregar ${short(sym)} a la suite?\n\nDesde ahí la suite graba su libro, su cinta y Hyperliquid mientras esté abierta: de 3 a 20 MB de libro por día. La nube no la graba.`)) return;
    setAdding(true);
    setAddError(null);
    try {
      const d = await postJson('/api/suite/symbols', { symbol: sym });
      onSymbolsAdded(d.symbols);
    } catch (e) {
      setAddError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const data = scan.lists?.[panelList];
  const rows = data?.rows || [];
  const state = !status ? (scan.error ? `Sin respuesta del servidor: ${scan.error}` : 'Cargando…')
    : status.running ? (status.building ? `Armando: ${status.loaded} de ${status.candidates} monedas` : `Mira ${status.universe} perpetuos · ${status.candidates} candidatas`)
      : !status.enabled ? 'Apagado'
        : status.env_off ? 'Apagado en este servidor (SUITE_SCANNER=0)'
          : status.other_process ? 'Otro proceso mira con esta carpeta de datos' : 'Encendido; empieza en unos segundos';
  const inSuite = new Set(suiteSymbols);
  return (
    <div className="wl-panel">
      <div className="bot-section">
        <div className="wl-panel-title">
          <h3>Scanner</h3>
          <button type="button" className="suite-btn" onClick={onHide} title="Ocultar el panel (se vuelve a abrir con «Scanner»)">Ocultar ›</button>
        </div>
        <div className="wl-row">
          <span className={`suite-dot ${status?.running ? 'ok' : 'bad'}`} />
          <span>{state}</span>
        </div>
        {status && (
          <div className="wl-row wl-muted">
            {status.tickers_at ? `Precios ${ago(status.tickers_at)}` : 'Sin precios todavía'}
            {status.cycle ? ` · medidas de las ${colombiaTime(status.cycle.at)} (${status.cycle.seconds} s)` : ''}
          </div>
        )}
        <div className="wl-row">
          <button type="button" className="suite-btn" disabled={toggling || !status} onClick={toggleScanner}>
            {(config?.enabled ?? status?.enabled) ? 'Apagar el scanner' : 'Encender el scanner'}
          </button>
        </div>
        {(status?.errors || []).slice(-1).map(e => <div key={e.at} className="suite-result bad">{e.text}</div>)}
        <div className="wl-row wl-muted">
          Solo mira: no envía nada al bot ni graba estas monedas. Dice dónde está la actividad y cuánto cuesta operar ahí; no son señales.
        </div>
      </div>

      <div className="bot-section">
        <h3>La cuadrícula</h3>
        <div className="wl-row">
          <select className="suite-select" value={source} onChange={(e) => onSource(e.target.value)} aria-label="Monedas de la cuadrícula">
            <option value="mias">Mis monedas</option>
            <option value="scanner">Las del scanner</option>
            <option value="ambas">Las dos</option>
          </select>
          {source !== 'mias' && (
            <>
              <select className="suite-select" value={gridList} onChange={(e) => onGridList(e.target.value)} aria-label="Lista del scanner">
                {GRID_LISTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <select className="suite-select" value={count} onChange={(e) => onCount(Number(e.target.value))} aria-label="Cuántas">
                {GRID_COUNTS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </>
          )}
        </div>
        {source !== 'mias' && (
          <div className="wl-row wl-muted">
            Las primeras {count} de «{LIST_SHORT[gridList]}»{pins.length ? `, más ${pins.length} fijada${pins.length > 1 ? 's' : ''}` : ''}. Solo velas de Bybit: sin footprints ni libro hasta agregarlas a la suite.
          </div>
        )}
      </div>

      <MarketSection market={data?.market || scan.market} />

      <div className="bot-section">
        <div className="wl-tabs">
          {LIST_TABS.map(([k, label]) => (
            <button key={k} type="button" className={`suite-btn ${k === panelList ? 'active' : ''}`} onClick={() => onPanelList(k)}>
              {label}{status?.lists?.[k] != null ? ` (${status.lists[k]})` : ''}
            </button>
          ))}
        </div>
        {data?.rule && <div className="wl-row wl-muted">{data.rule}</div>}
        {rows.length === 0 ? (
          <div className="bot-empty">{data ? (data.building ? 'Armando las medidas…' : 'Ninguna por ahora.') : 'Cargando…'}</div>
        ) : (
          <table className="bot-table wl-scan">
            <thead>
              <tr>
                <th>Moneda</th>
                <th>Por qué</th>
                <th title={`Costo de ida y vuelta en R de un stop de ${config?.stop_atr1h ?? 1} ATR de 1 h, con ${config?.size_usdt?.toLocaleString('en-US') ?? '—'} USDT. *: estimado con el spread`}>R</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.symbol} className={`wl-signal ${selected === row.symbol ? 'wl-selected' : ''}`}
                    onClick={() => setSelected(s => (s === row.symbol ? null : row.symbol))}
                    title={[...(row.chips || []).map(c => `${c.text}: ${c.title}`), ...(row.flags || []).map(f => `Aviso: ${f.text}`),
                      row.member?.grace ? 'Ya no cumple la regla: sale en una hora si no vuelve' : ''].filter(Boolean).join('\n')}>
                  <td>
                    <span className={row.member?.dir > 0 ? 'pos' : row.member?.dir < 0 ? 'neg' : ''}>{short(row.symbol)}</span>
                    {pins.includes(row.symbol) && <span className="wl-chip">fija</span>}
                    {row.member?.grace && <span className="wl-muted"> (sale)</span>}
                  </td>
                  <td className="wl-chips"><Chips row={row} max={3} /></td>
                  <td className={costClass(row.cost_r_1h)}>{costText(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selected && (
          <CoinDetail symbol={selected} data={detail.symbol === selected ? detail.data : null} error={detail.symbol === selected ? detail.error : null}
                      config={config || data?.config} inBot={botCoins === undefined ? undefined : botCoins === null ? null : botCoins.has(selected)}
                      inSuite={inSuite.has(selected)} pinned={pins.includes(selected)} onTogglePin={onTogglePin} onAdd={addToSuite}
                      adding={adding} onOpenChart={onOpenChart} gridTf={gridTf} />
        )}
        {addError && <div className="suite-result bad">{addError}</div>}
      </div>

      <div className="bot-section">
        <h3>Últimas entradas y salidas</h3>
        {events.length === 0 ? <div className="bot-empty">Todavía ninguna.</div> : (
          <table className="bot-table">
            <thead><tr><th>Hora</th><th>Moneda</th><th>Lista</th></tr></thead>
            <tbody>
              {events.map(e => (
                <tr key={`${e.at}-${e.list}-${e.symbol}-${e.type}`} className="wl-signal" onClick={() => setSelected(e.symbol)}
                    title={`${e.type === 'entra' ? 'Entró' : 'Salió'} · ${(e.chips || []).join(' · ')}`}>
                  <td>{colombiaTime(e.at)}</td>
                  <td>{short(e.symbol)}</td>
                  <td className={e.type === 'entra' ? 'pos' : 'neg'}>{e.type === 'entra' ? 'entra a' : 'sale de'} {LIST_SHORT[e.list] || e.list}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfigSection config={config} onSaved={() => { readConfig(); onRefresh(); }} />
    </div>
  );
}
