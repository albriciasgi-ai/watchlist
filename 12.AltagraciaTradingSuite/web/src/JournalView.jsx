import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { roleLabel } from '@app1/components/indicators/analysisLevels.js';
import { deleteJson, getJson, postJson } from './api.js';
import { subscribeBook } from './botBook.js';
import JournalDashboard from './JournalDashboard.jsx';
import { TAB } from './tabs.js';

// Al volver del gráfico con un trade (13/11/2026): los días que lo incluyen, de las opciones de la lista
const DAY_OPTIONS = [7, 30, 90, 365];
const daysFor = (trade) => {
  const last = trade?.closed_at || trade?.opened_at;
  if (!last) return 30;
  const need = Math.ceil((Date.now() - last) / 86400000) + 1;
  return DAY_OPTIONS.find(d => d >= Math.max(30, need)) || 365;
};

// Lo que muestra el journal: la lista de trades o el dashboard (13/11/2026), por pestaña
const VIEW_KEY = `suite_journal_view_${TAB}`;
const loadView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'dashboard' ? 'dashboard' : 'trades';
  } catch {
    return 'trades';
  }
};

/**
 * Journal de trades reales (paso 4 de la integración, 12/11/2026): el Observador de App 1 con trades de verdad.
 * Primera parte: los hechos de cada trade, del bot y de Bybit. Apertura con su origen (alerta o panel), SL y TP
 * iniciales; cierres con el resultado neto de comisiones; R sobre el riesgo del SL inicial; notas propias.
 * Los abiertos muestran el P&L sin realizar de Bybit (precio marca).
 */

const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const price = (v) => (num(v) === null ? '—' : String(Number(Number(v).toPrecision(10))));
// Un nivel calculado (VWAP, POC...) trae decimales de más: 7 cifras, como su etiqueta en el gráfico
const levelPrice = (v) => (num(v) === null ? '—' : String(Number(Number(v).toPrecision(7))));
const money = (v) => (num(v) === null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`);
const when = (ms) => (ms ? new Date(ms).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const duration = (min) => {
  if (min === null || min === undefined) return '—';
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 1440) return `${(min / 60).toFixed(1)} h`;
  return `${(min / 1440).toFixed(1)} d`;
};
const originText = (t) => [t.origin, t.source].filter(Boolean).join(' · ');

/**
 * Cuánto le falta a un trade abierto para tocar su TP y su SL (12/11/2026, pedido del usuario): lo que debe moverse
 * el precio marca de Bybit, en % del precio, hacia el TP o hacia el SL vigentes. Negativo: ya lo pasó
 */
function distances(t, position) {
  const mark = num(position?.markPrice);
  if (!(mark > 0)) return { tp: null, sl: null, mark: null };
  const level = (v) => (num(v) > 0 ? num(v) : null);
  const tp = level(position?.takeProfit) ?? level(t.take_profit);
  const sl = level(position?.stopLoss) ?? level(t.stop_loss);
  const dir = t.side === 'Buy' ? 1 : -1;
  return {
    mark,
    tp: tp === null ? null : (dir * (tp - mark) / mark) * 100,
    sl: sl === null ? null : (dir * (mark - sl) / mark) * 100,
    hasTp: tp !== null,
    hasSl: sl !== null,
  };
}
const pct = (v) => `${v.toFixed(2)}%`;

const imageUrl = (path) => `/api/screenshots/session/${path}`;
const IMAGE_NAMES = { decision: 'Decisión', open: 'Apertura', close: 'Cierre', after: '10 velas después', analysis: 'Análisis post-trade' };
const value = (v) => (v === null || v === undefined ? '—' : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

// La regla del laboratorio (13/11/2026): los mismos nombres del Observador de App 1
const STATES = { up: 'Alcista', down: 'Bajista', range: 'Consolidación' };
const FAVOR = { favor: 'a favor del trade', against: 'en contra del trade', range: 'sin dirección' };
const OI_STATES = { up: 'Creciendo', down: 'Cayendo', mixed: 'Mixto' };
const FRAME_NAMES = { 240: '4h', 60: '1h', 15: '15m' };
const share = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
const signedPct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
const rValue = (v) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`);

/** Lo que leía la regla, bloque por bloque, como lo describe el Observador de App 1 (sin "Tú": la suite no pide marcas) */
function readingRows(rows) {
  return (rows || []).map(row => {
    if (row.block === 'context_240' || row.block === 'context_60') {
      const label = row.block === 'context_240' ? 'Contexto 4 horas' : 'Contexto 1 hora';
      if (!row.rule) return { label, text: 'Sin velas suficientes' };
      return { label, text: `${STATES[row.rule]}, ${FAVOR[row.favor]} (eficiencia ${row.efficiency.toFixed(2)}, volumen en velas alcistas ${share(row.up_volume)})` };
    }
    if (row.block === 'move') {
      const frames = row.rule ? Object.keys(row.rule).sort((a, b) => b - a) : [];
      return {
        label: 'Movimiento con volumen',
        text: frames.length
          ? frames.map(tf => {
            const m = row.rule[tf];
            return `${FRAME_NAMES[tf]}: ${levelPrice(m.lo)} a ${levelPrice(m.hi)}, volumen ${m.ratio.toFixed(1)}x, ${m.atrs.toFixed(1)} ATR`;
          }).join(' · ')
          : 'Sin movimiento vigente a favor',
      };
    }
    if (row.block === 'zone') {
      const z = row.rule;
      return {
        label: 'Zona',
        text: z
          ? `${z.typ === 'FVG' ? 'FVG' : 'Cluster de volumen'} de ${FRAME_NAMES[z.tf]} ${levelPrice(z.x0)} a ${levelPrice(z.x1)}, a ${(row.gap * 100).toFixed(2)}% de la entrada${row.near ? ': cerca (0.10% o menos)' : ''}`
          : 'Sin zonas del lado del trade',
        note: !z || row.chance === null || row.chance === undefined ? null : `Por azar, el ${share(row.chance)} de los precios cercanos queda igual de cerca de una zona`,
      };
    }
    if (row.block === 'oi') return { label: 'Interés abierto', text: row.rule ? `${OI_STATES[row.rule]} (${signedPct(row.change)} en 4 horas)` : 'Sin dato de OI' };
    return { label: 'Volumen', text: row.rule === null || row.rule === undefined ? 'Sin dato' : `Última vela de 15m: ${row.rule.toFixed(1)}x su promedio` };
  });
}

/** La lectura de la regla del laboratorio en el minuto de la decisión: solo con el trade cerrado, como en App 1 */
function ReadingTable({ data, trade }) {
  if (trade.status !== 'closed') {
    return <div className="bot-empty">La lectura de la regla del laboratorio se ve cuando el trade se cierra, como en el Observador de App 1.</div>;
  }
  if (!data) return <div className="bot-empty">Leyendo la regla del laboratorio en el minuto de la decisión…</div>;
  if (!data.available) return <div className="bot-empty">Sin lectura de la regla: {data.reason || data.error || 'no disponible'}</div>;
  const parts = (data.conditions || []).filter(c => c.rule);
  const present = parts.filter(c => c.value === true).length;
  const cover = data.coverage || {};
  return (
    <div style={{ margin: '8px 0' }}>
      <div className="bot-empty">
        Regla del laboratorio (la del Observador de App 1) a las {when(data.at)}, desde el lado del trade
        {data.entry ? `, entrada ${price(data.entry)}` : ''}. Solo usa lo ocurrido antes de decidir.
      </div>
      {!data.complete && (
        <div className="bot-warning">
          Lectura parcial: la regla mira {(cover.needed || 46) - 1} días antes de la decisión y {trade.symbol}{' '}
          {cover.from
            ? `tiene trades grabados desde el ${cover.from.slice(8, 10)}/${cover.from.slice(5, 7)} (${cover.days} ${cover.days === 1 ? 'día seguido' : 'días seguidos'})`
            : 'no tiene trades grabados de esos días'}.
          {' '}Lo que no alcanzó a ver sale sin dato o sin movimiento, y este trade no entra en el informe de la regla.
        </div>
      )}
      {!data.final && <div className="bot-empty">El almacén de trades todavía no llega a la hora de la decisión: la lectura puede cambiar.</div>}
      <table className="bot-table">
        <thead><tr><th>Bloque</th><th>Lo que leía la regla</th></tr></thead>
        <tbody>
          {readingRows(data.rows).map(row => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td style={{ whiteSpace: 'normal' }}>{row.text}{row.note ? <div style={{ opacity: 0.7 }}>{row.note}</div> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {parts.length > 0 && (
        <div className="bot-empty">
          Partes de la regla presentes: {present} de {parts.length}. {parts.map(c => `${c.label}: ${c.value === true ? 'sí' : c.value === false ? 'no' : 'sin dato'}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

/** Acierto y R de un grupo, como en el informe del Observador de App 1 */
function Outcome({ stats }) {
  if (!stats || !stats.n) return <td colSpan={2} style={{ opacity: 0.6 }}>sin trades</td>;
  return (<><td>{share(stats.win_rate)} ({stats.wins}/{stats.n})</td><td>{rValue(stats.avg_r)}</td></>);
}

/** Lo que leía la regla en los trades cerrados: las tablas del informe del Observador de App 1, con lecturas completas */
function RuleReport({ rule }) {
  return (
    <div style={{ marginTop: 14 }}>
      <h3>Lo que leía la regla del laboratorio (lectura al decidir, como el Observador de App 1)</h3>
      <div className="bot-empty">
        {rule.complete} trades con lectura completa
        {rule.partial ? ` · ${rule.partial} con lectura parcial, fuera de estas tablas (su moneda tiene menos de 45 días de trades grabados antes de la decisión)` : ''}
        {rule.without ? ` · ${rule.without} sin lectura` : ''}
        {rule.pending ? ` · faltan ${rule.pending}: pide el informe otra vez para leerlas` : ''}.
      </div>
      {rule.small_sample && rule.complete > 0 && (
        <div className="bot-warning">Muestra pequeña: con menos de 30 trades estas diferencias pueden ser azar. Sirven para ver hábitos, no para concluir.</div>
      )}
      {rule.complete > 0 && (
        <>
          <table className="bot-table">
            <thead>
              <tr><th rowSpan={2}>Condición</th><th rowSpan={2}>Presente</th><th colSpan={2}>Con</th><th colSpan={2}>Sin</th></tr>
              <tr><th>Acierto</th><th>R</th><th>Acierto</th><th>R</th></tr>
            </thead>
            <tbody>
              {rule.conditions.map(row => (
                <tr key={row.id}><td>{row.label}</td><td>{share(row.share)}</td><Outcome stats={row.with} /><Outcome stats={row.without} /></tr>
              ))}
            </tbody>
          </table>
          {rule.habits?.length > 0 && (
            <>
              <h3 style={{ marginTop: 10 }}>Cuánto sigues cada parte de la regla</h3>
              <table className="bot-table">
                <thead><tr><th>Parte de la regla</th><th>Presente en tus trades</th></tr></thead>
                <tbody>{rule.habits.map(row => <tr key={row.id}><td>{row.label}</td><td>{share(row.share)}</td></tr>)}</tbody>
              </table>
            </>
          )}
          {rule.zones?.orders > 0 && (
            <div className="bot-empty">
              Entradas cerca de una zona: {rule.zones.near} de {rule.zones.orders} ({share(rule.zones.near / rule.zones.orders)}).
              Por azar se esperaría {share(rule.zones.chance)}: si estás cerca de eso, la regla todavía no distingue tus entradas.
            </div>
          )}
          {rule.best_worst?.length > 0 && (
            <>
              <h3 style={{ marginTop: 10 }}>Tus mejores trades contra los peores (por R)</h3>
              <table className="bot-table">
                <thead><tr><th>Condición</th><th>Mejor tercio</th><th>Peor tercio</th></tr></thead>
                <tbody>{rule.best_worst.map(row => <tr key={row.id}><td>{row.label}</td><td>{share(row.best)}</td><td>{share(row.worst)}</td></tr>)}</tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Las medidas de App 1 al decidir, por grupo (marco), en columnas */
function MeasuresTable({ data, catalog }) {
  if (!data) return <div className="bot-empty">Calculando las medidas al decidir (pide velas a Bybit)…</div>;
  if (!data.available) return <div className="bot-empty">Sin medidas: {data.reason || data.error || 'no disponibles'}</div>;
  const groups = {};
  for (const item of catalog || []) (groups[item.group] = groups[item.group] || []).push(item);
  return (
    <div>
      <div className="bot-empty">
        Medidas de App 1 al cerrar la vela de 15m de las {when(data.decision_candle)} (antes de decidir), vistas desde el lado del trade.
        {data.best_r !== undefined && data.best_r !== null && ` Lo máximo a favor: ${data.best_r.toFixed(2)} R · en contra: ${data.worst_r.toFixed(2)} R (velas de 5 min).`}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '2px 16px', fontSize: 12 }}>
        {Object.entries(groups).map(([group, items]) => (
          <React.Fragment key={group}>
            <div style={{ gridColumn: '1 / -1', fontWeight: 600, marginTop: 6 }}>{group}</div>
            {items.map(item => (
              <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ opacity: 0.8 }}>{item.label}</span><b>{value(data.decision?.[item.key])}</b>
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/**
 * focus (13/11/2026): al volver del gráfico con "Volver al journal", el trade que se miraba ({ trade }). Queda elegido, en
 * la lista de trades y con sus días, y la vista baja a su detalle. onFocusDone avisa que ya se usó
 */
export default function JournalView({ active, onShowTrade, focus = null, onFocusDone = null }) {
  const [days, setDays] = useState(() => daysFor(focus?.trade));
  const [catalog, setCatalog] = useState(null);
  const [measures, setMeasures] = useState({}); // trade_id -> medidas al decidir
  const [readings, setReadings] = useState({}); // trade_id -> lectura de la regla del laboratorio (trades cerrados)
  const [report, setReport] = useState(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(focus?.trade?.trade_id || null);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState({});
  const [view, setView] = useState(() => (focus ? 'trades' : loadView()));
  const detailRef = useRef(null);
  const scrollToDetail = useRef(Boolean(focus));
  useEffect(() => {
    if (focus) onFocusDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const chooseView = (next) => {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* sin almacenamiento */ }
  };

  const read = useCallback(async () => {
    try {
      const d = await getJson(`/api/bot/journal?days=${days}`);
      setData(d);
      setError(null);
    } catch (e) {
      setError(/not found/i.test(e.message)
        ? 'El bot que está corriendo es de antes del journal: reinícialo (puerto 5000).'
        : `No se pudo leer el journal: ${e.message}`);
    }
  }, [days]);
  useEffect(() => {
    if (!active) return undefined;
    read();
    const timer = setInterval(read, 15000);
    return () => clearInterval(timer);
  }, [active, read]);
  // P&L sin realizar de los abiertos: el de Bybit, del libro de posiciones (cada 2 s)
  useEffect(() => {
    if (!active) return undefined;
    return subscribeBook((book) => {
      const map = {};
      for (const p of book.positions || []) map[`${p.symbol}:${p.side}`] = p;
      setLive(map);
    });
  }, [active]);

  const trades = data?.trades || [];
  const closed = trades.filter(t => t.status === 'closed');
  const stats = useMemo(() => {
    const wins = closed.filter(t => (t.pnl || 0) > 0).length;
    const total = closed.reduce((s, t) => s + (t.pnl || 0), 0);
    const rs = closed.map(t => num(t.r)).filter(r => r !== null);
    const groups = {};
    for (const t of closed) {
      const key = originText(t) || '—';
      const g = groups[key] || (groups[key] = { n: 0, wins: 0, pnl: 0, rs: [] });
      g.n += 1;
      if ((t.pnl || 0) > 0) g.wins += 1;
      g.pnl += t.pnl || 0;
      if (num(t.r) !== null) g.rs.push(t.r);
    }
    return {
      n: closed.length, wins, total, avgR: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null, rN: rs.length,
      groups: Object.entries(groups).sort((a, b) => b[1].n - a[1].n),
    };
  }, [closed]);
  const selected = trades.find(t => t.trade_id === selectedId) || null;
  // De vuelta del gráfico: la vista baja una vez al detalle del trade, cuando llega del journal del bot
  useEffect(() => {
    if (!scrollToDetail.current || !selected) return;
    scrollToDetail.current = false;
    detailRef.current?.scrollIntoView({ block: 'start' });
  }, [selected]);

  // Medidas del trade elegido: se piden una vez por trade (cerradas quedan guardadas en el servidor). La lista se
  // vuelve a leer cada pocos segundos: el registro de pedidos evita pedirlas otra vez mientras llegan
  const requested = useRef(new Set());
  useEffect(() => {
    if (!selectedId || requested.current.has(selectedId)) return;
    requested.current.add(selectedId);
    if (!catalog) getJson('/api/journal/catalog').then(d => setCatalog(d.measures || [])).catch(() => setCatalog([]));
    getJson(`/api/journal/measures/${encodeURIComponent(selectedId)}`)
      .then(d => setMeasures(m => ({ ...m, [selectedId]: d })))
      .catch(e => setMeasures(m => ({ ...m, [selectedId]: { available: false, error: e.message } })));
  }, [selectedId, catalog]);

  // Lectura de la regla: solo de un trade cerrado (el servidor tampoco la da antes). Guardada en el servidor una vez
  // que el almacén llegó a la hora de la decisión; mientras tanto se vuelve a pedir, a lo sumo cada minuto
  const readingAsked = useRef(new Map());
  const selectedStatus = selected?.status;
  useEffect(() => {
    if (!selectedId || selectedStatus !== 'closed') return;
    const have = readings[selectedId];
    if (have && (have.final || have.cached)) return;
    const last = readingAsked.current.get(selectedId);
    if (last && Date.now() - last < 60000) return;
    readingAsked.current.set(selectedId, Date.now());
    const id = selectedId;
    getJson(`/api/journal/reading/${encodeURIComponent(id)}`)
      .then(d => setReadings(r => ({ ...r, [id]: d })))
      .catch(e => setReadings(r => ({ ...r, [id]: { available: false, error: e.message } })));
  }, [selectedId, selectedStatus, readings, data]);

  const askReport = async () => {
    setReportBusy(true);
    try {
      setReport(await getJson(`/api/journal/report?days=${days}`));
    } catch (e) {
      setReport({ error: e.message });
    } finally {
      setReportBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    try {
      const r = await postJson('/api/bot/journal/sync', {});
      setNotice(r.added ? `${r.added} cierre(s) nuevo(s) de Bybit` : 'Sin cierres nuevos en Bybit');
      await read();
    } catch (e) {
      setNotice(`No se pudo: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };
  // Borrar una imagen del análisis post-trade (13/11/2026, pedido del usuario): solo las de análisis, con confirmación
  const removeAnalysisImage = async (img) => {
    if (!selected || busy) return;
    if (!window.confirm(`¿Borrar esta imagen del análisis post-trade (${when(img.at)})?\n\nNo se puede deshacer.`)) return;
    setBusy(true);
    try {
      await deleteJson(`/api/journal/analysis/${encodeURIComponent(selected.trade_id)}/image?image=${encodeURIComponent(img.image)}`);
      setNotice('Imagen del análisis borrada');
      await read();
    } catch (e) {
      setNotice(`La imagen no se borró: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };
  const saveNote = async () => {
    if (!selected || !note.trim()) return;
    setBusy(true);
    try {
      await postJson(`/api/bot/journal/${encodeURIComponent(selected.trade_id)}/note`, { text: note.trim() });
      setNote('');
      await read();
    } catch (e) {
      setNotice(`La nota no se guardó: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <div className="bot-warning">{error}</div>;
  if (!data) return <div className="bot-empty">Leyendo el journal del bot…</div>;

  return (
    <div>
      {error && <div className="bot-warning">{error}</div>}
      <div className="bot-cards">
        <div className="bot-card"><div className="label">Trades cerrados</div><div className="value">{stats.n}</div></div>
        <div className="bot-card"><div className="label">Acierto</div><div className="value">{stats.n ? `${Math.round((stats.wins / stats.n) * 100)}%` : '—'}</div></div>
        <div className="bot-card"><div className="label">P&L neto (USD)</div><div className={`value ${stats.total >= 0 ? 'pos' : 'neg'}`}>{stats.n ? money(stats.total) : '—'}</div></div>
        <div className="bot-card">
          <div className="label">R promedio</div>
          <div className={`value ${(stats.avgR || 0) >= 0 ? 'pos' : 'neg'}`}>{stats.avgR === null ? '—' : stats.avgR.toFixed(2)}</div>
          {stats.rN < stats.n && <div className="label">{stats.rN} de {stats.n} con SL</div>}
        </div>
        <div className="bot-card"><div className="label">Abiertos</div><div className="value">{trades.length - closed.length}</div></div>
      </div>

      <div className="suite-add-coin">
        <button type="button" className={`suite-btn ${view === 'trades' ? 'active' : ''}`} onClick={() => chooseView('trades')}>Trades</button>
        <button type="button" className={`suite-btn ${view === 'dashboard' ? 'active' : ''}`} onClick={() => chooseView('dashboard')}
          title="Curva de capital, P&L por trade, Win Rate, Profit Factor, riesgo y recompensa: el dashboard de App 1 con los trades reales">
          Dashboard
        </button>
        <label>Últimos
          <select className="suite-input" style={{ width: 80, marginLeft: 6 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 30, 90, 365].map(d => <option key={d} value={d}>{d} días</option>)}
          </select>
        </label>
        <button type="button" className="suite-btn" disabled={busy} onClick={sync}>Pedir cierres a Bybit</button>
        {view === 'trades' && (
          <button type="button" className="suite-btn" disabled={reportBusy} onClick={askReport}>{reportBusy ? 'Armando el informe…' : 'Informe: qué distingue a las ganadoras'}</button>
        )}
        {notice && <span className="bot-empty">{notice}</span>}
      </div>

      {view === 'dashboard' && <JournalDashboard trades={trades} days={days} />}

      {view === 'trades' && (<>
      {report && (
        <div className="bot-section">
          <h3>Qué distingue a las ganadoras de las perdedoras (medidas al decidir)</h3>
          {report.error && <div className="bot-warning">{report.error}</div>}
          {!report.error && (
            <>
              <div className="bot-empty">
                {report.winners} ganadoras y {report.losers} perdedoras con medidas
                {report.without_measures ? ` · ${report.without_measures} sin medidas (anteriores al journal)` : ''}
                {report.pending ? ` · faltan ${report.pending}: pide el informe otra vez para calcularlas` : ''}.
                {' '}"Separa" = en qué parte de los pares (una ganadora, una perdedora) la ganadora tiene el valor mayor; 50% es no distinguirlas.
              </div>
              {report.small_sample && (
                <div className="bot-warning">Muestra pequeña (menos de 30 trades o de 5 por grupo): el informe describe, no es evidencia.</div>
              )}
              {report.rows?.length > 0 && (
                <table className="bot-table">
                  <thead><tr><th>Medida</th><th>Grupo</th><th>Ganadoras (mediana)</th><th>Perdedoras (mediana)</th><th>Separa</th><th /></tr></thead>
                  <tbody>
                    {report.rows.slice(0, 15).map(row => (
                      <tr key={row.key}>
                        <td>{row.label}</td><td>{row.group}</td><td>{value(row.first_median)}</td><td>{value(row.second_median)}</td>
                        <td>{Math.round(row.share * 100)}%</td><td>{row.clear ? <b className="pos">más que el azar</b> : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {report.rule && <RuleReport rule={report.rule} />}
            </>
          )}
        </div>
      )}

      {stats.groups.length > 1 && (
        <div className="bot-section">
          <h3>Por origen</h3>
          <table className="bot-table">
            <thead><tr><th>Origen</th><th>Trades</th><th>Acierto</th><th>P&L neto</th><th>R promedio</th></tr></thead>
            <tbody>
              {stats.groups.map(([key, g]) => (
                <tr key={key}>
                  <td>{key}</td><td>{g.n}</td><td>{Math.round((g.wins / g.n) * 100)}%</td>
                  <td className={g.pnl >= 0 ? 'pos' : 'neg'}>{money(g.pnl)}</td>
                  <td>{g.rs.length ? (g.rs.reduce((s, r) => s + r, 0) / g.rs.length).toFixed(2) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bot-section">
        <h3>Trades</h3>
        {!trades.length && <div className="bot-empty">Sin trades en estos días. Las aperturas se anotan desde que el bot tiene el journal; los cierres llegan de Bybit.</div>}
        {trades.length > 0 && (
          <table className="bot-table">
            <thead>
              <tr>
                <th>Abierto</th><th>Moneda</th><th>Lado</th><th>Origen</th><th>Tamaño</th><th>Entrada</th><th>Salida</th><th>SL inicial</th><th>P&L</th>
                <th title="Cuánto debe moverse el precio para tocar el TP vigente">Al TP</th>
                <th title="Cuánto debe moverse el precio para tocar el SL vigente">Al SL</th>
                <th>R</th><th>Duración</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {trades.map(t => {
                const position = live[`${t.symbol}:${t.side}`];
                const open = t.status === 'open';
                const pnl = open ? num(position?.unrealizedPnl) : t.pnl;
                const gap = open && position ? distances(t, position) : null;
                return (
                  <tr key={t.trade_id} onClick={() => setSelectedId(t.trade_id === selectedId ? null : t.trade_id)}
                    style={{ cursor: 'pointer', background: t.trade_id === selectedId ? 'var(--t-hover, #eef3ff)' : undefined }}>
                    <td title={t.pre_existing && t.opened_at ? `El bot la vio por primera vez el ${when(t.opened_at)}` : ''}>
                      {t.opened_at && !t.pre_existing ? when(t.opened_at) : 'antes'}
                    </td>
                    <td>{t.symbol}</td>
                    <td className={t.side === 'Buy' ? 'pos' : 'neg'}>{t.side === 'Buy' ? 'LONG' : 'SHORT'}</td>
                    <td>{originText(t)}</td>
                    <td>{t.size}</td>
                    <td>{price(t.entry)}</td>
                    <td>{price(t.exit)}</td>
                    <td>{t.initial_stop_loss ? price(t.initial_stop_loss) : <span className="neg">sin SL</span>}</td>
                    <td className={(pnl || 0) >= 0 ? 'pos' : 'neg'}>{money(pnl)}{open && pnl !== null ? ' *' : ''}</td>
                    <td title={gap?.mark ? `Precio marca ${price(gap.mark)}` : ''}>
                      {!gap || gap.mark === null ? '—' : gap.hasTp ? pct(gap.tp) : 'sin TP'}
                    </td>
                    <td title={gap?.mark ? `Precio marca ${price(gap.mark)}` : ''}>
                      {!gap || gap.mark === null ? '—' : gap.hasSl ? pct(gap.sl) : <span className="neg">sin SL</span>}
                    </td>
                    <td>{num(t.r) === null ? '—' : t.r.toFixed(2)}</td>
                    <td>{duration(t.duration_min)}</td>
                    <td>{open ? (position ? 'abierto' : 'sin posición') : 'cerrado'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="bot-empty">
          P&L neto de comisiones, de Bybit. * Abiertos: sin realizar, al precio marca. R = resultado sobre lo que arriesgaba el SL inicial.
          Al TP / Al SL (abiertos): cuánto debe moverse el precio marca, en % del precio, para tocar el TP o el SL vigentes.
          "Anterior": la posición ya estaba abierta cuando el bot empezó el journal. "Externa": no la abrió el bot (Bybit a mano u otra app).
        </div>
      </div>

      {selected && (
        <div className="bot-section" ref={detailRef}>
          <h3>
            {selected.symbol} · {selected.side === 'Buy' ? 'LONG' : 'SHORT'} · {originText(selected)}{selected.pattern ? ` · ${selected.pattern}` : ''}
            {onShowTrade && (selected.opened_at || selected.closed_at) && (
              <button type="button" className="suite-btn" style={{ marginLeft: 10 }} onClick={() => onShowTrade(selected)}
                title="El trade en su moneda, desde su apertura y con su caja. Ahí, con “Análisis post-trade”, puedes dibujar sobre él y guardar una imagen aquí">
                Ver en el gráfico
              </button>
            )}
          </h3>
          {selected.images?.length > 0 && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '6px 0' }}>
              {selected.images.map(img => (
                <div key={`${img.kind}:${img.image}`} style={{ textAlign: 'center', fontSize: 12 }}>
                  <a href={imageUrl(img.image)} target="_blank" rel="noreferrer" title="Abrir a tamaño real" style={{ display: 'block' }}>
                    <img src={imageUrl(img.image)} alt={IMAGE_NAMES[img.kind]} style={{ width: 260, border: '1px solid var(--t-line, #ccc)', display: 'block' }} />
                    {IMAGE_NAMES[img.kind] || img.kind} · {when(img.until || img.at)}{img.frame ? ` · ${img.frame}` : ''}
                    {img.note && <div style={{ maxWidth: 260, whiteSpace: 'normal', opacity: 0.85 }}>“{img.note}”</div>}
                  </a>
                  {img.kind === 'analysis' && (
                    <button type="button" className="suite-btn" style={{ marginTop: 4 }} disabled={busy} onClick={() => removeAnalysisImage(img)}
                      title="Borrar esta imagen del análisis post-trade (no se puede deshacer)">
                      Borrar
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {selected.decision && (
            <div className="bot-empty">
              Decisión ({when(selected.decision.at)}){selected.decision.note ? `: “${selected.decision.note}”` : ''}
              {selected.decision.order && ` · orden ${selected.decision.order.type || ''} ${selected.decision.order.qty ?? ''} a ${price(selected.decision.order.entry)}, stop ${price(selected.decision.order.stop)}, objetivo ${price(selected.decision.order.target)}`}
              {selected.decision.levels?.length > 0 && (
                <ol style={{ margin: '4px 0 0 20px', padding: 0 }} title="El número es el de la imagen de la decisión">
                  {selected.decision.levels.map((lv, i) => (
                    <li key={lv.id || i}>
                      {lv.role !== undefined && lv.role !== null ? `${roleLabel(lv.role)}: ` : ''}{lv.label || lv.kind || 'nivel'}
                      {lv.source && lv.source !== lv.kind ? ` (${lv.source})` : ''}{lv.price && !lv.mark ? ` ${levelPrice(lv.price)}` : ''}{lv.note ? ` — ${lv.note}` : ''}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
          <div className="bot-empty">
            Cuenta {selected.account || '—'}{selected.mode ? ` (${String(selected.mode).toUpperCase()})` : ''} · apalancamiento {selected.leverage ?? '—'}x
            {' '}· SL inicial {price(selected.initial_stop_loss)} · TP inicial {price(selected.initial_take_profit)}
            {' '}· SL actual {price(selected.stop_loss)} · TP actual {price(selected.take_profit)}
            {selected.risk ? ` · riesgo ${selected.risk.toFixed(2)} USD` : ''}
          </div>
          {selected.closes.length > 0 && (
            <table className="bot-table">
              <thead><tr><th>Cierre</th><th>Cantidad</th><th>Entrada</th><th>Salida</th><th>P&L neto</th><th>Tipo</th></tr></thead>
              <tbody>
                {selected.closes.map(cl => (
                  <tr key={cl.close_id}>
                    <td>{when(cl.closed_at)}</td><td>{cl.qty}</td><td>{price(cl.entry)}</td><td>{price(cl.exit)}</td>
                    <td className={(cl.pnl || 0) >= 0 ? 'pos' : 'neg'}>{money(cl.pnl)}</td><td>{cl.order_type || ''} {cl.exec_type || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {selected.changes.length > 0 && (
            <div className="bot-empty">
              Cambios: {selected.changes.map(ch => `${when(ch.at)} ${['stop_loss', 'take_profit', 'size'].filter(k => k in ch)
                .map(k => `${k === 'stop_loss' ? 'SL' : k === 'take_profit' ? 'TP' : 'tamaño'} ${price(ch[k])}`).join(', ')}`).join(' · ')}
            </div>
          )}
          <ReadingTable data={readings[selected.trade_id]} trade={selected} />
          <MeasuresTable data={measures[selected.trade_id]} catalog={catalog} />
          <div>
            {selected.notes.map((n, i) => <div key={i} className="bot-empty">{when(n.at)} · {n.text}</div>)}
          </div>
          <div className="suite-add-coin">
            <textarea className="suite-input" style={{ width: '100%', minHeight: 60 }} maxLength={4000}
              placeholder="Nota: por qué entraste, qué viste, qué harías distinto…" value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="button" className="suite-btn" disabled={busy || !note.trim()} onClick={saveNote}>Guardar nota</button>
          </div>
        </div>
      )}
      </>)}
    </div>
  );
}
