import React, { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '../../config.js';
import { THEME, isNewTheme } from '../uiTheme.js';
import { TF_LABEL, describeRule, fmtR } from './ruleTester.js';
import { elementLabel, elementLabels } from './elementLabels.js';

/**
 * Pestaña "Búsqueda" del backtesting global: algoritmo genético sobre las casillas de la regla, solo en la fase 1.
 * Todo corre en el backend (rule_search.py). Aquí se elige la configuración, se sigue el avance y se leen las finalistas.
 * La validación interna de cada regla (lo posterior a la fecha de corte) solo se muestra cuando la búsqueda terminó.
 */

const SEARCH_KEY = 'tester_search_v1';
const NAMES = {
  CC: 'Cambio de carácter', VH: 'Volumen alto para su hora', LIQ: 'Barrido de liquidaciones', HM: 'Martillo o estrella',
  EN: 'Envolvente', DJ: 'Doji', RF: 'Flecha de Volumen de Respuesta', RB: 'Rombo de Volumen de Respuesta', GC: 'Gaussian Channel',
  BX: 'Ruptura de caja', BE: 'Borde de caja, hacia el centro', CP: 'Compresión (va con las dos órdenes stop)', FV: 'FVG nuevo',
  SP: 'Swing del detector', IM: 'Impulso'
};
const DEFAULT_CONFIG = {
  tfs: [240], codes: ['CC', 'VH', 'HM', 'EN', 'DJ', 'RF', 'RB', 'GC', 'BX', 'BE', 'CP', 'FV', 'SP', 'IM'], population: 60, generations: 25, maxElements: 2,
  minTrades: 150, minCoins: 4, split: '2023-01-01', lines: true, invert: true, mutation: 0.1,
  flow: true, regime: true, trailing: true, straddle: true, checkNew: true
};

const api = async (path, body) => {
  const response = await fetch(`${API_BASE_URL}${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`El backend respondió ${response.status}`);
  return response.json();
};

const loadConfig = () => {
  try {
    return { ...DEFAULT_CONFIG, ...(JSON.parse(localStorage.getItem(SEARCH_KEY)) || {}).config };
  } catch {
    return DEFAULT_CONFIG;
  }
};
const loadLast = () => {
  try {
    return (JSON.parse(localStorage.getItem(SEARCH_KEY)) || {}).last || null;
  } catch {
    return null;
  }
};
const store = (config, last) => {
  try {
    localStorage.setItem(SEARCH_KEY, JSON.stringify({ config, last }));
  } catch { /* sin almacenamiento se usa igual */ }
};

const tone = (value) => {
  if (!value) return undefined;
  if (value > 0) return isNewTheme() ? THEME.upText : '#0a7d5a';
  return isNewTheme() ? THEME.downText : '#c62828';
};
const R = ({ value, digits = 3 }) => <span style={{ color: tone(value) }}>{fmtR(value, digits)}</span>;
const Num = ({ value, onChange, min, max, step = 1, disabled }) => (
  <input type="number" value={value} min={min} max={max} step={step} disabled={disabled}
    onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} style={{ width: 64 }} />
);
const Check = ({ checked, onChange, children, title, disabled }) => (
  <label title={title}><input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />{children}</label>
);
const STATE = { running: 'corriendo', done: 'terminada', stopped: 'detenida', error: 'con error' };
const date = (ms) => (ms ? new Date(ms).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '');

export default function RuleSearchTab({ onLoadRule }) {
  const [config, setConfig] = useState(loadConfig);
  const [current, setCurrent] = useState(loadLast);
  const [data, setData] = useState(null);
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const patch = (change) => setConfig(previous => ({ ...previous, ...change }));
  const toggle = (key, value) => setConfig(previous => {
    const has = previous[key].includes(value);
    return { ...previous, [key]: has ? previous[key].filter(x => x !== value) : [...previous[key], value] };
  });

  useEffect(() => store(config, current), [config, current]);
  const loadList = useCallback(() => api('/api/search/list').then(r => r.success && setList(r.searches)).catch(() => {}), []);
  useEffect(() => { loadList(); }, [loadList]);

  const refresh = useCallback(async (id) => {
    if (!id) return;
    const answer = await api(`/api/search/${id}`);
    if (answer.success) setData(answer);
    else setMessage(answer.message);
  }, []);
  useEffect(() => { refresh(current).catch(error => setMessage(error.message)); }, [current, refresh]);
  useEffect(() => {
    if (data?.state !== 'running') return undefined;
    const timer = setInterval(() => refresh(data.id).catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [data?.state, data?.id, refresh]);
  useEffect(() => { if (data && data.state !== 'running') loadList(); }, [data?.state, loadList]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async (resume) => {
    setBusy(true);
    setMessage('');
    try {
      const answer = await api('/api/search/start', resume ? { resume } : { config });
      if (!answer.success) {
        setMessage(answer.message);
        return;
      }
      if (answer.already) setMessage('Ya había una búsqueda corriendo: se sigue esa.');
      setCurrent(answer.search);
      await refresh(answer.search);
      loadList();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    if (!data?.id) return;
    await api(`/api/search/stop/${data.id}`, {}).catch(error => setMessage(error.message));
    setMessage('Se detiene al terminar la regla en curso. Lo hecho queda guardado y se puede retomar.');
  };

  const running = data?.state === 'running';
  const report = data?.report;
  const cfg = data?.config;
  const job = data?.job;
  const pct = job?.total ? Math.round(100 * job.done / job.total) : 0;
  const estimate = (config.population || 0) * (config.generations || 0);

  return (
    <>
      <div className="rt-note" style={{ marginBottom: 8 }}>
        Un algoritmo genético arma reglas con las mismas casillas de la pestaña "Regla" (elementos, ventana, entrada, stop, salida y un filtro
        de VWAP o EMA), las corre en todas las monedas y se queda con las mejores para cruzarlas y mutarlas. Usa solo la <b>fase 1</b>, partida
        en dos: elige con lo anterior a la fecha de corte y guarda lo posterior como <b>validación</b>, que no decide nada y solo se muestra al
        terminar. Corre en el backend, sin gastar tokens. Las fases 2 y 3 no se tocan.
      </div>

      {!running && (
        <div className="rt-group">
          <h4>Búsqueda nueva</h4>
          <div className="rt-row">
            <span>Marcos</span>
            {[60, 240, 1440].map(tf => <button key={tf} type="button" className={`rt-btn${config.tfs.includes(tf) ? ' on' : ''}`} onClick={() => toggle('tfs', tf)}>{TF_LABEL[tf]}</button>)}
          </div>
          {config.tfs.includes(60) && <div className="rt-note">En 1h, la primera vez detecta los elementos de la fase en cada moneda con almacén: varios minutos por moneda.</div>}
          <div className="rt-chips" style={{ margin: '6px 0' }}>
            {Object.keys(NAMES).map(code => (
              <button key={code} type="button" className={`rt-chip${config.codes.includes(code) ? ' on' : ''}`} onClick={() => toggle('codes', code)}
                title={`${code} · ${NAMES[code]}${code === 'LIQ' ? ' · lento: arma las zonas de liquidaciones en cada vela' : ''}`}>
                {elementLabel(code, NAMES[code])}
              </button>
            ))}
          </div>
          <div className="rt-row">
            <span>Hasta</span><Num value={config.maxElements} min={1} max={3} onChange={(maxElements) => patch({ maxElements })} /><span>elementos por regla</span>
            <Check checked={config.lines} onChange={(lines) => patch({ lines })}>filtro de VWAP o EMA</Check>
            <Check checked={config.invert} onChange={(invert) => patch({ invert })}>puede invertir</Check>
          </div>
          <div className="rt-row">
            <span>Puede usar</span>
            <Check checked={config.flow !== false} onChange={(flow) => patch({ flow })} title="Filtros de CVD de N velas a favor y de OI">filtros de CVD y OI</Check>
            <Check checked={config.regime !== false} onChange={(regime) => patch({ regime })} title="Solo dentro, solo fuera o solo tras romper un rango">régimen</Check>
            <Check checked={config.trailing !== false} onChange={(trailing) => patch({ trailing })} title="Trailing a 3 o 4 ATR o al 5% del mejor precio, con arranque y stop a la entrada">trailing</Check>
            <Check checked={config.straddle !== false} onChange={(straddle) => patch({ straddle })} title="Dos órdenes stop, una arriba y otra abajo: entra la primera">dos órdenes stop</Check>
          </div>
          <div className="rt-row">
            <Check checked={config.checkNew !== false} onChange={(checkNew) => patch({ checkNew })}
              title="Al terminar, cada finalista se corre también en las monedas nuevas, en toda su fase 1. Nunca eligen nada: solo dicen si lo encontrado se repite en monedas que la búsqueda no vio">
              Al terminar, comprobar las finalistas en las monedas nuevas</Check>
          </div>
          <div className="rt-note">
            La búsqueda elige siempre con las 7 monedas de siempre. Con más piezas hay más reglas posibles y más suerte: el umbral de suerte del informe lo tiene en cuenta.
          </div>
          <div className="rt-row">
            <span>Población</span><Num value={config.population} min={10} max={300} onChange={(population) => patch({ population })} />
            <span>generaciones</span><Num value={config.generations} min={1} max={200} onChange={(generations) => patch({ generations })} />
            <span>mutación</span><Num value={config.mutation} min={0.01} max={0.5} step={0.01} onChange={(mutation) => patch({ mutation })} />
          </div>
          <div className="rt-row">
            <span>Mínimo</span><Num value={config.minTrades} min={20} max={5000} onChange={(minTrades) => patch({ minTrades })} /><span>trades y a favor en</span>
            <Num value={config.minCoins} min={1} max={10} onChange={(minCoins) => patch({ minCoins })} /><span>monedas</span>
          </div>
          <div className="rt-row">
            <span>Validación desde</span>
            <input type="date" value={config.split} min="2021-06-01" max="2023-10-01" onChange={(e) => patch({ split: e.target.value })} />
            <span className="rt-note">hasta el final de la fase 1 (31/12/2023)</span>
          </div>
          <div className="rt-note">
            Hasta {estimate.toLocaleString('es-CO')} reglas (las repetidas no se vuelven a correr), unos 2 a 4 s cada una en 4h. Se puede dejar corriendo:
            cada generación queda guardada, y si se corta se retoma.
          </div>
          <button type="button" className="rt-btn primary" style={{ width: '100%', padding: '6px 0', margin: '6px 0' }}
            disabled={busy || !config.tfs.length || !config.codes.length} onClick={() => start(null)}>
            {busy ? 'Empezando…' : 'Empezar la búsqueda'}
          </button>
        </div>
      )}
      {message && <div className="rt-warn">{message}</div>}

      {data && (
        <div className="rt-group">
          <h4>Búsqueda {data.id} · {STATE[data.state] || data.state}</h4>
          <div className="rt-note">
            {cfg.tfs.map(tf => TF_LABEL[tf]).join(', ')} · {elementLabels(cfg.codes, ', ')} · hasta {cfg.maxElements} elementos · población {cfg.population} ·
            {' '}{cfg.generations} generaciones · validación desde {cfg.split} · semilla {cfg.seed} · empezada {date(data.startedAt)}
          </div>
          {running && job && (
            <>
              <div className="rt-progress" style={{ margin: '6px 0' }}><div style={{ width: `${pct}%` }} /></div>
              <div className="rt-note">{job.stage}</div>
              <button type="button" className="rt-btn" onClick={stop} style={{ marginTop: 4 }}>Detener</button>
            </>
          )}
          {data.state === 'error' && <div className="rt-warn">{data.error}</div>}
          {(data.state === 'stopped' || data.state === 'error') && (
            <button type="button" className="rt-btn primary" disabled={busy} onClick={() => start(data.id)} style={{ marginTop: 4 }}>
              Retomar desde la generación {data.generation + 1}
            </button>
          )}
          <div className="rt-note" style={{ marginTop: 6 }}>Reglas distintas probadas: <b>{data.tested}</b>. Generación {data.generation} de {cfg.generations}.</div>
          {data.history?.length > 0 && (
            <table className="rt-table" style={{ marginTop: 4 }}>
              <thead><tr><th>Gen.</th><th>Mejor aptitud</th><th>Mediana</th><th>Con trades suficientes</th><th>Probadas</th></tr></thead>
              <tbody>
                {data.history.slice(-8).map(h => (
                  <tr key={h.generation}><td>{h.generation}</td><td><R value={h.best} /></td><td><R value={h.median} /></td><td>{h.qualified}</td><td>{h.tested}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {report && (
        <div className="rt-group">
          <h4>Resultado</h4>
          <div className="rt-note">
            De <b>{report.tested}</b> reglas probadas, {report.qualified} llegaron al mínimo de trades. Entre tantas, una regla sin ventaja puede
            verse hasta <b>{fmtR(report.luckR)}</b> R sobre los controles por pura suerte: una ventaja menor que eso en el tramo de búsqueda no dice nada.
          </div>
          <div className="rt-note" style={{ marginTop: 4 }}>
            En la validación, el 10% con mejor aptitud ({report.topCount} reglas) dio <R value={report.topHoldEdge} /> R sobre los controles, contra
            {' '}<R value={report.allHoldEdge} /> R de todas. Si las mejores no superan al resto en la validación, la búsqueda eligió suerte.
            {report.spearman != null && <> Correlación por rangos entre búsqueda y validación: {report.spearman} ({report.pairs} reglas); alta no significa
              ventaja, porque las reglas que pierden suelen perder en los dos tramos.</>}
          </div>
          <h4 style={{ marginTop: 8 }}>Finalistas</h4>
          {!report.finalists.length && <div className="rt-note">Ninguna regla llegó al mínimo de trades.</div>}
          {report.finalists.map((f, i) => (
            <div key={f.key} style={{ borderTop: "1px solid var(--t-line, #ddd)", padding: "6px 0", marginBottom: 4 }}>
              <div><b>{i + 1}.</b> {describeRule(f.rule)}</div>
              <div className={f.candidate ? 'rt-warn' : 'rt-note'} style={{ margin: '4px 0' }}><b>{f.verdict}</b></div>
              <table className="rt-table">
                <thead><tr><th></th><th>Trades</th><th>R medio</th><th>Sobre controles</th><th>Monedas a favor</th></tr></thead>
                <tbody>
                  <tr><td>Búsqueda</td><td>{f.train.n}</td><td><R value={f.train.avgR} /></td><td><R value={f.train.edge} /> ±{f.train.se ? (1.96 * f.train.se).toFixed(2) : '—'}</td><td>{f.train.coinsUp} de {f.train.coinsWith}</td></tr>
                  <tr><td>Validación</td><td>{f.hold.n}</td><td><R value={f.hold.avgR} /></td><td><R value={f.hold.edge} /> ±{f.hold.se ? (1.96 * f.hold.se).toFixed(2) : '—'}</td><td>{f.hold.coinsUp} de {f.hold.coinsWith}</td></tr>
                  {f.newCoins && ['train', 'hold'].map(seg => (
                    <tr key={seg} title="Las monedas nuevas, que la búsqueda nunca vio, en el mismo tramo de su fase 1">
                      <td>Nuevas, {seg === 'train' ? 'búsqueda' : 'validación'}</td><td>{f.newCoins[seg].n}</td><td><R value={f.newCoins[seg].avgR} /></td>
                      <td><R value={f.newCoins[seg].edge} /> ±{f.newCoins[seg].se ? (1.96 * f.newCoins[seg].se).toFixed(2) : '—'}</td><td>{f.newCoins[seg].coinsUp} de {f.newCoins[seg].coinsWith}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="rt-note" style={{ marginTop: 4 }}>
                Vecinas (un valor movido al de al lado): {f.neighborsUp} de {f.neighbors.length} con ventaja en la búsqueda.
                {' '}Por moneda en la validación: {f.coins.filter(c => c.hold?.n).map(c => `${c.symbol.replace('USDT', '')} ${fmtR(c.hold.edge, 2)} (${c.hold.n})`).join(' · ')}
              </div>
              <button type="button" className="rt-btn" style={{ marginTop: 4 }} onClick={() => onLoadRule(f.rule)}
                title="Carga la regla en la pestaña Regla. Desde ahí se corre como cualquier otra, y la fase 2 pide confirmar como siempre">
                Cargar en la pestaña Regla
              </button>
            </div>
          ))}
          <div className="rt-note">
            Una candidata se corre en la pestaña "Regla" con "Correr en todas las monedas" en la fase 1 y, si te convence, en la fase 2. Lleva a la
            fase 2 solo dos o tres, elegidas ahora y sin ajustarlas después: cada regla que pasa por ahí la gasta un poco.
          </div>
        </div>
      )}

      {data?.best?.length > 0 && (
        <div className="rt-group">
          <h4>Mejores en el tramo de búsqueda</h4>
          <div className="rt-note">Las que eligió el algoritmo, sin las vecinas que se prueban al terminar.</div>
          <table className="rt-table">
            <thead><tr><th>Regla</th><th>Aptitud</th><th>Trades</th><th>Sobre controles</th>{report && <th>Validación</th>}<th></th></tr></thead>
            <tbody>
              {data.best.map(b => (
                <tr key={b.key}>
                  <td style={{ maxWidth: 260, whiteSpace: "normal", textAlign: "left" }}>{describeRule(b.rule)}</td>
                  <td><R value={b.fitness} /></td><td>{b.train.n}</td><td><R value={b.train.edge} /></td>
                  {report && <td><R value={b.hold?.edge} /> ({b.hold?.n ?? 0})</td>}
                  <td><button type="button" className="rt-btn" onClick={() => onLoadRule(b.rule)} title="Cargar en la pestaña Regla">Regla</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.length > 0 && (
        <div className="rt-group">
          <h4>Búsquedas anteriores</h4>
          <table className="rt-table">
            <thead><tr><th style={{ textAlign: 'left' }}>Búsqueda</th><th>Estado</th><th>Candidatas</th><th></th></tr></thead>
            <tbody>
              {list.map(s => (
                <tr key={s.id}>
                  <td style={{ whiteSpace: 'normal', textAlign: 'left' }}>{date(s.startedAt)}<br /><span className="rt-note">{s.config.tfs.map(tf => TF_LABEL[tf]).join(', ')} · {elementLabels(s.config.codes, ', ')} · {s.tested} reglas</span></td>
                  <td>{STATE[s.state] || s.state}</td><td>{s.state === 'done' ? s.candidates : '—'}</td>
                  <td><button type="button" className="rt-btn" onClick={() => setCurrent(s.id)}>Ver</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
