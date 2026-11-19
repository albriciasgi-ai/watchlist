import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '../../config.js';
import { THEME, isNewTheme } from '../uiTheme.js';
import { describeRule, fmtR } from './ruleTester.js';

/**
 * Pestaña "Estrategias" del backtesting global: cada regla que se ha corrido, con su resultado por fase en las monedas
 * de siempre (S) y en las nuevas (N), la lectura automática y el orden de las más sólidas (backend/strategy_board.py).
 * Pedido del usuario el 19/11: ver cómo salieron las anteriores sin depender de Claude, y que la app diga cuál es más
 * ganadora y por qué. El estado y la nota de cada estrategia son del usuario y se guardan en el backend.
 */

const VIEW_KEY = 'tester_strategies_v1';
const STATUS = [['', 'sin estado'], ['candidata', 'candidata'], ['en prueba', 'en prueba'], ['descartada', 'descartada']];
const GROUP = { base: 'S', new: 'N' };
const GROUP_NAME = { base: 'las de siempre', new: 'las nuevas' };

const api = async (path, body) => {
  const response = await fetch(`${API_BASE_URL}${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`El backend respondió ${response.status}`);
  return response.json();
};

const color = (kind) => {
  const fresh = isNewTheme();
  return {
    good: fresh ? THEME.upText : '#0a7d5a', bad: fresh ? THEME.downText : '#c62828',
    warn: '#b26a00', info: fresh ? THEME.textMuted : '#666'
  }[kind];
};
const R = ({ value, digits = 2 }) => <span style={{ color: value ? color(value > 0 ? 'good' : 'bad') : undefined }}>{fmtR(value, digits)}</span>;
const date = (ms) => (ms ? new Date(ms).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '');
const loadView = () => {
  try {
    return { search: '', several: true, status: 'all', ...(JSON.parse(localStorage.getItem(VIEW_KEY)) || {}) };
  } catch {
    return { search: '', several: true, status: 'all' };
  }
};

/** Una celda fase × grupo, en una línea: trades, R y ventaja, con ✓ si pasa. */
const Badge = ({ phase, group, cell, onClick }) => {
  if (!cell || !cell.n) return null;
  const fresh = phase > 1 || group === 'new';
  const mark = cell.edge ? (cell.pass ? '✓' : '✗') : '·';
  const kind = cell.edge ? (cell.pass ? 'good' : fresh ? 'bad' : 'warn') : 'info';
  return (
    <button type="button" className="rt-chip" onClick={onClick} style={{ borderColor: color(kind), marginRight: 4, marginBottom: 3 }}
      title={`Fase ${phase} en ${GROUP_NAME[group]}: ${cell.n} trades en ${cell.withTrades} monedas. Clic: abre el informe de todas esas monedas`}>
      <b style={{ color: color(kind) }}>{mark}</b> F{phase} {GROUP[group]} <R value={cell.avgR} /> · {cell.n}
    </button>
  );
};

export default function StrategiesTab({ onLoadRule, onOpenReport }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [view, setView] = useState(loadView);
  const [notes, setNotes] = useState({});

  const refresh = useCallback(async () => {
    try {
      const found = await api('/api/tester/strategies');
      setData(found);
      setError(found.success ? null : found.message);
    } catch (e) {
      setError(`${e.message}. Si acabas de actualizar, reinicia el backend de App 1.`);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  // Mientras el backend resume las corridas viejas, se vuelve a preguntar
  useEffect(() => {
    if (!data?.preparing) return undefined;
    const timer = setTimeout(refresh, 4000);
    return () => clearTimeout(timer);
  }, [data, refresh]);
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* sin almacenamiento */ } }, [view]);

  const shown = useMemo(() => {
    const text = view.search.trim().toLowerCase();
    return (data?.strategies || []).filter(s => {
      const coins = Math.max(0, ...Object.values(s.cells).flatMap(groups => Object.values(groups).map(c => c.withTrades || 0)));
      if (view.several && coins < 2) return false;
      if (view.status !== 'all' && (s.status || '') !== view.status) return false;
      if (!text) return true;
      return s.names.some(n => n.toLowerCase().includes(text)) || describeRule(s.rule).toLowerCase().includes(text);
    });
  }, [data, view]);

  const saveNote = async (key, patch) => {
    const result = await api('/api/tester/strategies/note', { key, ...patch });
    if (result.success) {
      setData(current => current && { ...current, strategies: current.strategies.map(s => (s.key === key ? { ...s, status: result.status, note: result.note } : s)) });
    }
  };

  if (error) return <div className="rt-warn">{error}</div>;
  if (!data) return <div className="rt-note">Leyendo las estrategias…</div>;

  const byKey = Object.fromEntries((data.strategies || []).map(s => [s.key, s]));
  return (
    <>
      {data.preparing && (
        <div className="rt-warn">
          Resumiendo las corridas guardadas: {data.preparing.done} de {data.preparing.total}. Las viejas reciben aquí el control del tramo, y eso tarda la primera vez.
          Lo de abajo se completa solo.
        </div>
      )}
      {data.ranking?.length > 0 && (
        <div className="rt-group">
          <h4>Las más sólidas</h4>
          <div className="rt-note" style={{ marginBottom: 4 }}>
            Primero las que no cayeron en ninguna comprobación, después las que pasan más, y entre iguales la de peor margen más alto.
            Comprobación es todo lo que no se usó para elegir la regla: las fases 2 y 3, y cualquier fase de las monedas nuevas.
          </div>
          {data.ranking.map((r, i) => (
            <div key={r.key} style={{ marginBottom: 4, cursor: 'pointer' }} onClick={() => setOpen(r.key)}>
              <b>{i + 1}. {r.name}</b> <span style={{ color: color(r.tone) }}>· {r.verdict}</span>
              <div className="rt-note">{r.why}{byKey[r.key]?.status ? ` · ${byKey[r.key].status}` : ''}</div>
            </div>
          ))}
        </div>
      )}
      <div className="rt-row">
        <input type="text" placeholder="Buscar por nombre o regla" value={view.search} onChange={(e) => setView(v => ({ ...v, search: e.target.value }))} style={{ flex: 1, minWidth: 120 }} />
        <select value={view.status} onChange={(e) => setView(v => ({ ...v, status: e.target.value }))}>
          <option value="all">todos los estados</option>
          {STATUS.map(([value, label]) => <option key={value || 'none'} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="rt-row">
        <label title="Oculta las reglas que solo se corrieron en una moneda"><input type="checkbox" checked={view.several} onChange={(e) => setView(v => ({ ...v, several: e.target.checked }))} />solo las corridas en 2 monedas o más</label>
        <button type="button" className="rt-btn" onClick={refresh}>Actualizar</button>
      </div>
      <div className="rt-note" style={{ marginBottom: 6 }}>
        {shown.length} de {data.strategies.length} estrategias. Cada etiqueta es una fase (F1 a F3) en las de siempre (S) o en las nuevas (N), con el R por trade y los trades:
        ✓ pasa (ventaja sobre los dos controles con margen que no toca el cero), ✗ no pasa.
      </div>
      {shown.map(s => {
        const isOpen = open === s.key;
        const phases = Object.keys(s.cells).sort();
        return (
          <div key={s.key} style={{ borderTop: '1px solid var(--t-line, #ddd)', padding: '6px 0' }}>
            <div style={{ cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : s.key)}>
              <b>{s.name}</b>{s.status && <span className="rt-note"> · {s.status}</span>}
              <span className="rt-note" style={{ float: 'right' }}>{date(s.lastAt)}</span>
              <div style={{ color: color(s.analysis.tone), fontSize: 11 }}>{s.analysis.verdict}</div>
            </div>
            <div style={{ marginTop: 3 }}>
              {phases.flatMap(p => ['base', 'new'].map(g => (
                <Badge key={`${p}${g}`} phase={Number(p)} group={g} cell={s.cells[p][g]} onClick={() => onOpenReport(s.rule, Number(p), g)} />
              )))}
            </div>
            {isOpen && (
              <div style={{ marginTop: 4 }}>
                <div className="rt-note">{describeRule(s.rule)}{s.names.length > 1 ? ` · también guardada como ${s.names.filter(n => n !== s.name).join(', ')}` : ''}</div>
                <h4 style={{ margin: '8px 0 4px', fontSize: 11, textTransform: 'uppercase', color: 'var(--t-muted, #666)' }}>Lectura</h4>
                {s.analysis.points.map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 3, lineHeight: 1.4 }}>
                    <span style={{ color: color(p.tone) }}>{p.tone === 'good' ? '✓' : p.tone === 'bad' ? '✗' : p.tone === 'warn' ? '!' : '·'}</span>
                    <span>{p.text}</span>
                  </div>
                ))}
                <table className="rt-table" style={{ marginTop: 6 }}>
                  <thead><tr><th>Fase</th><th>Trades</th><th>R</th><th>Vs. azar</th><th>Vs. tramo</th><th>Largos</th><th>Cortos</th><th>Monedas +</th></tr></thead>
                  <tbody>
                    {phases.flatMap(p => ['base', 'new'].filter(g => s.cells[p][g]?.n).map(g => {
                      const c = s.cells[p][g];
                      return (
                        <tr key={`${p}${g}`} className="pick" onClick={() => onOpenReport(s.rule, Number(p), g)} title="Abre el informe de esas monedas">
                          <td>F{p} {GROUP[g]}</td><td>{c.n}</td><td><R value={c.avgR} /></td>
                          <td title={c.edge ? `de ${fmtR(c.edge.low)} a ${fmtR(c.edge.high)}` : ''}>{c.edge ? <R value={c.edge.r} /> : '—'}</td>
                          <td title={c.legEdge ? `de ${fmtR(c.legEdge.low)} a ${fmtR(c.legEdge.high)}` : 'sin el control del tramo'}>{c.legEdge ? <R value={c.legEdge.r} /> : '—'}</td>
                          <td><R value={c.long?.avgR} /></td><td><R value={c.short?.avgR} /></td><td>{c.positive} de {c.withTrades}</td>
                        </tr>
                      );
                    }))}
                  </tbody>
                </table>
                <div className="rt-row" style={{ marginTop: 6 }}>
                  <span>Estado</span>
                  <select value={s.status || ''} onChange={(e) => saveNote(s.key, { status: e.target.value })}>
                    {STATUS.map(([value, label]) => <option key={value || 'none'} value={value}>{label}</option>)}
                  </select>
                  <button type="button" className="rt-btn" onClick={() => onLoadRule(s.rule)} title="Carga la regla en la pestaña Regla">Cargar en la pestaña Regla</button>
                </div>
                <textarea rows={3} style={{ width: '100%', boxSizing: 'border-box', fontSize: 12 }} placeholder="Nota (se guarda al salir del campo)"
                  value={notes[s.key] ?? s.note ?? ''} onChange={(e) => setNotes(n => ({ ...n, [s.key]: e.target.value }))}
                  onBlur={() => notes[s.key] !== undefined && notes[s.key] !== (s.note || '') && saveNote(s.key, { note: notes[s.key] })} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
