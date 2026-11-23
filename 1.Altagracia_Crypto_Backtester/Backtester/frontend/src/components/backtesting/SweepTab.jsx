import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '../../config.js';
import { THEME, isNewTheme } from '../uiTheme.js';
import { TF_LABEL } from './ruleTester.js';
import { elementLabel } from './elementLabels.js';

/**
 * Pestaña "Barrido" del backtesting global (23/11/2026, pedido del usuario): un mapa de qué elementos traen algo, sin
 * entrada, stop ni objetivo. Todo corre en el backend (signal_sweep.py).
 * - En cada señal, desde la apertura de la vela siguiente: si el precio llega a +2 ATR antes que a −2 ATR, y cuánto fue
 *   a favor y en contra a 6, 12, 24 y 48 velas, contra las velas de su mismo trimestre y lado.
 * - Solo la fase 1 y solo los dos primeros tramos del embudo: la puerta no se mira aquí.
 * - La nota es el peor de los dos tramos. Negativa y pareja: el elemento sirve al revés.
 * - Segundo paso: marcar elementos y barrer sus parejas.
 */

const SWEEP_KEY = 'tester_sweep_v1';
const TFS = [5, 15, 60, 240, 1440];
const GROUPS = [['base', 'las 7 de siempre'], ['new', 'las nuevas'], ['all', 'todas']];
const DEFAULT = { tf: 240, group: 'base', flow: true, minSignals: 50 };

const api = async (path, body) => {
  const response = await fetch(`${API_BASE_URL}${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`El backend respondió ${response.status}`);
  return response.json();
};
const load = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(SWEEP_KEY)) || {};
    return { config: { ...DEFAULT, ...saved.config }, last: saved.last || null };
  } catch {
    return { config: DEFAULT, last: null };
  }
};
const tone = (value) => {
  if (!value) return undefined;
  if (value > 0) return isNewTheme() ? THEME.upText : '#0a7d5a';
  return isNewTheme() ? THEME.downText : '#c62828';
};
const signed = (value, digits = 1) => (value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${Number(value).toFixed(digits)}`);
const Val = ({ value, digits }) => <span style={{ color: tone(value) }}>{signed(value, digits)}</span>;
const date = (ms) => (ms ? new Date(ms).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '');
const day = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');

/** El reparto de las pruebas (su t con los dos tramos juntos) contra lo que da el azar: cajas de medio error */
const Spread = ({ scores }) => {
  if (!scores?.length) return null;
  const edges = [-3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3];
  const counts = new Array(edges.length + 1).fill(0);
  scores.forEach(t => { counts[edges.filter(e => t >= e).length] += 1; });
  const top = Math.max(...counts, 1);
  const width = 600 / counts.length;
  return (
    <svg className="rt-equity" style={{ height: 70 }} viewBox="0 0 600 70" preserveAspectRatio="none">
      {counts.map((count, i) => {
        const far = i <= 2 || i >= counts.length - 3;  // Más allá de ±2 errores
        const height = (count / top) * 62;
        return <rect key={i} x={i * width + 1} y={68 - height} width={width - 2} height={height} fill="currentColor" fillOpacity={far ? 0.55 : 0.2} />;
      })}
      <line x1="300" x2="300" y1="0" y2="70" stroke="currentColor" strokeOpacity="0.3" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

export default function SweepTab() {
  const initial = useMemo(load, []);
  const [config, setConfig] = useState(initial.config);
  const [current, setCurrent] = useState(initial.last);
  const [data, setData] = useState(null);
  const [past, setPast] = useState({ sweeps: [], tests: 0 });
  const [job, setJob] = useState(null);
  const [message, setMessage] = useState('');
  const [picked, setPicked] = useState([]);
  const [open, setOpen] = useState(null);
  const patch = (change) => setConfig(previous => ({ ...previous, ...change }));

  useEffect(() => {
    try {
      localStorage.setItem(SWEEP_KEY, JSON.stringify({ config, last: current }));
    } catch {
      // Sin almacenamiento, lo elegido dura hasta cerrar la ventana
    }
  }, [config, current]);

  const loadPast = useCallback(() => api('/api/sweep/list').then(r => r.success && setPast(r)).catch(() => {}), []);
  useEffect(() => { loadPast(); }, [loadPast]);
  useEffect(() => {
    if (!current) return;
    api(`/api/sweep/${current}`).then(r => (r.success ? setData(r) : setMessage(r.message))).catch(error => setMessage(error.message));
  }, [current]);
  useEffect(() => {
    if (!job || job.state !== 'running') return undefined;
    const timer = setInterval(async () => {
      try {
        const answer = await api(`/api/sweep/job/${job.id}`);
        if (!answer.success) return;
        setJob(answer.job);
        if (answer.job.state === 'done') {
          setCurrent(answer.job.sweep);
          setPicked([]);
          loadPast();
        }
        if (answer.job.state === 'error') setMessage(answer.job.error);
      } catch {
        // Un pedido que falla no corta el seguimiento
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [job, loadPast]);

  const start = async (pairs) => {
    setMessage('');
    try {
      const answer = await api('/api/sweep/start', { config: { ...config, pairs: pairs || [] } });
      if (!answer.success) {
        setMessage(answer.message);
        return;
      }
      if (answer.already) setMessage('Ya había un barrido corriendo: se sigue ese.');
      setJob({ id: answer.job, state: 'running', stage: 'Empezando', done: 0, total: 1 });
    } catch (error) {
      setMessage(error.message);
    }
  };

  const running = job?.state === 'running';
  const cfg = data?.config;
  const names = data?.names || {};
  const label = (row) => row.codes.map(code => elementLabel(code, names[code])).join(' + ');
  const main = data?.mainX;
  const first = (row, part) => row.parts?.[part]?.first?.[main] || row.parts?.[part]?.first?.[String(main)] || row.parts?.[part]?.first?.[`${main}.0`];
  const of = (group, key) => group?.[key] ?? group?.[String(key)] ?? group?.[`${key}.0`];
  const toggle = (code) => setPicked(previous => (previous.includes(code) ? previous.filter(c => c !== code) : [...previous, code].slice(0, 12)));
  const pairsMode = !!cfg?.pairs?.length;

  return (
    <>
      <div className="rt-group">
        <h4>Barrido de señales</h4>
        <div className="rt-note">
          Un mapa de qué elementos traen algo, sin entrada, stop ni objetivo. En cada señal se mira, desde la apertura de la vela siguiente, si el precio
          llega a +2 ATR antes que a −2 ATR (sin ventaja es 50%) y cuánto fue a favor y en contra, contra las velas de su mismo trimestre y lado.
          Solo la fase 1 y solo los dos primeros tramos del embudo: la puerta no se mira aquí. Sin comisiones: dice dónde buscar, no qué operar.
        </div>
        <div className="rt-row" style={{ marginTop: 6 }}>
          <span>Marco</span>
          {TFS.map(tf => (
            <button key={tf} type="button" className={`rt-btn${config.tf === tf ? ' on' : ''}`} onClick={() => patch({ tf })}>{TF_LABEL[tf] || `${tf}m`}</button>
          ))}
        </div>
        <div className="rt-row">
          <span>Monedas</span>
          <select value={config.group} onChange={(e) => patch({ group: e.target.value })}>
            {GROUPS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
          </select>
          <label title="Los elementos de order flow (imbalances, absorción, barridos reales…) solo existen en las monedas con almacén de trades y hasta 4 horas. La primera vez de cada marco hay que detectarlos en toda la fase: varios minutos por moneda en 15 y 5 minutos">
            <input type="checkbox" checked={config.flow !== false} onChange={(e) => patch({ flow: e.target.checked })} />con los de order flow
          </label>
        </div>
        <div className="rt-row">
          <span title="Con menos señales en alguno de los dos tramos, el elemento se muestra pero no se juzga">Mínimo</span>
          <input type="number" value={config.minSignals} min={20} max={2000} style={{ width: 64 }}
            onChange={(e) => patch({ minSignals: e.target.value === '' ? '' : Number(e.target.value) })} />
          <span>señales por tramo</span>
        </div>
        <button type="button" className="rt-btn primary" style={{ width: '100%', padding: '6px 0', margin: '6px 0' }} disabled={running} onClick={() => start(null)}>
          {running ? 'Barriendo…' : 'Barrer los elementos'}
        </button>
        {running && (
          <>
            <div className="rt-progress" style={{ margin: '6px 0' }}><div style={{ width: `${job.total ? Math.round(100 * job.done / job.total) : 0}%` }} /></div>
            <div className="rt-note">{job.stage}</div>
          </>
        )}
        {message && <div className="rt-warn">{message}</div>}
        {past.sweeps.length > 0 && (
          <div className="rt-note" style={{ marginTop: 4 }}>
            Barridos hechos: {past.sweeps.length}, con <b>{past.tests.toLocaleString('es-CO')}</b> pruebas juzgadas entre todos.{' '}
            {past.sweeps.slice(0, 6).map(s => (
              <button key={s.id} type="button" className={`rt-btn${s.id === current ? ' on' : ''}`} style={{ marginRight: 4, marginTop: 4 }} onClick={() => setCurrent(s.id)}
                title={`${date(s.at)} · ${s.tests} pruebas`}>
                {TF_LABEL[s.tf] || s.tf}{s.pairs ? ' parejas' : ''} · {s.group === 'base' ? 'de siempre' : s.group === 'new' ? 'nuevas' : 'todas'}
              </button>
            ))}
          </div>
        )}
      </div>

      {data && (
        <div className="rt-group">
          <h4>{pairsMode ? 'Parejas' : 'Elementos'} · {TF_LABEL[cfg.tf] || cfg.tf} · {date(data.at)}</h4>
          <div className="rt-note">
            {data.symbols.length} monedas · tramos hasta el {day(cfg.split1)} y del {day(cfg.split1)} al {day(cfg.split)}, hueco de {cfg.gapDays} días.
            {data.skipped?.length > 0 && ` Sin velas de ese marco: ${data.skipped.length}.`}
            {pairsMode && ` Pareja: las dos señales del mismo lado dentro de ${data.pairWindow} velas.`}
          </div>
          <div className="rt-note" style={{ marginTop: 4 }}>
            <b>Primero, el reparto.</b> De <b>{data.tests}</b> pruebas juzgadas, <b>{data.beyond2}</b> pasan de ±2 errores con los dos tramos juntos; por azar se
            esperan <b>{data.expected2}</b>. Si las dos cifras se parecen, no hay nada aquí, aunque la primera de la lista se vea bien.
          </div>
          <Spread scores={data.scores} />
          <div className="rt-note">
            Cada barra es media unidad de error, de −3 a +3; las oscuras son las que pasan de ±2. <b>La nota</b> de cada fila es el peor de sus dos tramos
            (cero si van en sentidos contrarios). Con {data.tests} pruebas, no es suerte desde <b>±{data.need}</b>: {data.clear ? `la pasan ${data.clear}` : 'ninguna la pasa'}.
            Una nota negativa dice que el elemento sirve al revés.
            {data.testsBefore > 0 && ` Antes de este barrido ya iban ${data.testsBefore.toLocaleString('es-CO')} pruebas en otros.`}
          </div>
          <table className="rt-table" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                {!pairsMode && <th title="Marca los que quieras cruzar entre sí (hasta 12)"></th>}
                <th>{pairsMode ? 'Pareja' : 'Elemento'}</th>
                <th title="El peor de los dos tramos, en errores">Nota</th>
                <th title="Señales en el primer tramo y en el segundo">Señales</th>
                <th title={`Parte de las señales que llega a +${main} ATR antes que a −${main} ATR. Sin ventaja, 50%`}>+{main} antes</th>
                <th title="Puntos sobre las velas de su trimestre y lado, primer tramo">Tramo 1</th>
                <th title="Puntos sobre las velas de su trimestre y lado, segundo tramo">Tramo 2</th>
                <th title={`A favor menos en contra a ${data.mainH} velas, en ATR, sobre las velas de su trimestre y lado. Los dos tramos juntos`}>Asimetría</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(row => {
                const a = first(row, 'a');
                const b = first(row, 'b');
                const both = first(row, 'both');
                const asym = of(row.parts?.both?.asym, data.mainH);
                return (
                  <React.Fragment key={row.key}>
                    <tr className={`pick${open === row.key ? ' sel' : ''}`} onClick={() => setOpen(open === row.key ? null : row.key)}
                      style={row.judged ? undefined : { opacity: 0.55 }} title={row.judged ? 'Clic para ver el detalle' : 'Pocas señales en algún tramo: no se juzga'}>
                      {!pairsMode && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={picked.includes(row.key)} onChange={() => toggle(row.key)} />
                        </td>
                      )}
                      <td style={{ textAlign: 'left', whiteSpace: 'normal', maxWidth: 190 }}>{label(row)}{row.clear ? ' ★' : ''}</td>
                      <td>{row.score === null ? '—' : <Val value={row.score} digits={2} />}</td>
                      <td>{row.parts.a.n} · {row.parts.b.n}</td>
                      <td>{both ? `${both.rate}%` : '—'}</td>
                      <td>{a ? <Val value={a.mean} /> : '—'}</td>
                      <td>{b ? <Val value={b.mean} /> : '—'}</td>
                      <td>{asym ? <Val value={asym.mean} digits={2} /> : '—'}</td>
                    </tr>
                    {open === row.key && (
                      <tr>
                        <td colSpan={pairsMode ? 7 : 8} style={{ textAlign: 'left', whiteSpace: 'normal' }}>
                          <div className="rt-note">
                            {row.coins} monedas con señales · {Math.round((row.parts.both.longs ?? 0) * 100)}% largos.
                            {' '}Llega a +X antes que a −X, en puntos sobre su control (tramo 1 · tramo 2):{' '}
                            {data.distances.map(x => {
                              const pa = of(row.parts.a?.first, x);
                              const pb = of(row.parts.b?.first, x);
                              return <span key={x}>{x} ATR {signed(pa?.mean)} (t {signed(pa?.t)}) · {signed(pb?.mean)} (t {signed(pb?.t)}); </span>;
                            })}
                          </div>
                          <table className="rt-table" style={{ marginBottom: 0 }}>
                            <thead><tr><th>Velas</th><th>A favor</th><th>En contra</th><th>Asimetría sobre su control</th><th>Tramo 1</th><th>Tramo 2</th></tr></thead>
                            <tbody>
                              {data.horizons.map(h => {
                                const bothStat = of(row.parts.both.asym, h);
                                return (
                                  <tr key={h}>
                                    <td>{h}</td>
                                    <td>{signed(of(row.parts.both.mfe, h), 2)}</td>
                                    <td>{signed(-of(row.parts.both.mae, h), 2)}</td>
                                    <td>{bothStat ? <><Val value={bothStat.mean} digits={2} /> ±{(1.96 * bothStat.se).toFixed(2)}</> : '—'}</td>
                                    <td>{signed(of(row.parts.a?.asym, h)?.mean, 2)}</td>
                                    <td>{signed(of(row.parts.b?.asym, h)?.mean, 2)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          <div className="rt-note">En ATR de la vela de la señal. "A favor" y "en contra" son promedios sin control: sirven para pensar dónde iría un stop o un objetivo.</div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {!pairsMode && (
            <div className="rt-row">
              <button type="button" className="rt-btn" disabled={running || picked.length < 2} onClick={() => start(picked)}
                title="Barre todas las parejas de los elementos marcados: las dos señales del mismo lado dentro de 3 velas">
                Barrer las parejas de los {picked.length} marcados{picked.length >= 2 ? ` (${(picked.length * (picked.length - 1)) / 2} pruebas)` : ''}
              </button>
            </div>
          )}
          <div className="rt-note">
            Lo que salga de aquí es una pista para la búsqueda genética (con esos elementos marcados) o para una regla a mano, no un resultado: se eligió mirando
            estos mismos datos. La puerta del embudo sigue sin tocar.
          </div>
        </div>
      )}
    </>
  );
}
