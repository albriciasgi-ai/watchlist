import React, { useMemo, useRef, useState } from 'react';
import './RejectionPatternSettings.css';
import { API_BASE_URL } from '../config.js';
import { OF_ELEMENTS } from './indicators/ofElements.js';
import {
  SETUP_LIBRARY, SETUP_MODES, allRecipes, cleanRecipe, recipeLabel, recipeText, saveSetupsConfig
} from './indicators/ofSetups.js';

const FILTERS = [['all', 'Todos'], ['active', 'Activos'], ['giro', 'Giro'], ['continuación', 'Continuación'], ['custom', 'Propios']];
const CODES_HINT = Object.entries(OF_ELEMENTS).map(([code, info]) => `${code} ${info.name}`).join(' · ');

const fmt = (value, digits = 2) => (value === null || value === undefined ? '–' : `${value > 0 ? '+' : ''}${Number(value).toFixed(digits)}`);

/** Resultado de una receta en el histórico, en una línea */
function EvalLine({ result }) {
  if (!result) return null;
  if (result.loading) return <span className="hint">Evaluando…</span>;
  if (result.error) return <span className="hint" style={{ color: '#C62828' }}>{result.error}</span>;
  const { setup, baseline, edgeR, smallSample } = result;
  const range = setup.wilson?.[0] !== null && setup.wilson?.[0] !== undefined ? ` (${setup.wilson[0]}–${setup.wilson[1]})` : '';
  return (
    <span className="hint" style={{ color: edgeR > 0 ? '#2E7D32' : '#555' }}>
      {setup.n} casos · acierto {setup.winRate ?? '–'}%{range} · R neto {fmt(setup.avgR)} · base {fmt(baseline.avgR)} · ventaja {fmt(edgeR)}
      {smallSample ? ' · muestra pequeña' : ''}
    </span>
  );
}

/** Editor de una receta: casillas, modo, ventana y filtros */
function RecipeEditor({ recipe, onSave, onSaveAsNew, onCancel }) {
  const [draft, setDraft] = useState(() => ({
    ...recipe,
    slots: recipe.slots.map(slot => ({ text: slot.codes.join('|'), group: slot.group }))
  }));
  const [error, setError] = useState(null);
  const set = (key, value) => setDraft(previous => ({ ...previous, [key]: value }));
  const setNested = (key, field, value) => setDraft(previous => ({ ...previous, [key]: { ...previous[key], [field]: value } }));
  const setSlot = (index, field, value) => setDraft(previous => ({
    ...previous, slots: previous.slots.map((slot, k) => (k === index ? { ...slot, [field]: value } : slot))
  }));

  const build = () => {
    const unknown = draft.slots.flatMap(slot => slot.text.split('|').map(code => code.trim().toUpperCase())).filter(code => code && !OF_ELEMENTS[code]);
    if (unknown.length) {
      setError(`Códigos desconocidos: ${unknown.join(', ')}`);
      return null;
    }
    const recipeOut = cleanRecipe({
      ...draft,
      slots: draft.slots.map(slot => ({ codes: slot.text.split('|').map(code => code.trim().toUpperCase()).filter(Boolean), group: Number(slot.group) || 0 }))
    });
    if (!recipeOut) setError('La receta necesita al menos una casilla con un código');
    return recipeOut;
  };

  return (
    <div className="settings-section" style={{ border: '1px solid #90A4AE', borderRadius: 6, padding: 10 }}>
      <h4>{recipe.builtin ? `Editar ${recipeLabel(recipe)}` : 'Receta propia'}</h4>
      <div className="setting-row"><label>Nombre</label><input type="text" value={draft.name} onChange={(e) => set('name', e.target.value)} /></div>
      <div className="setting-row">
        <label>Lado</label>
        <select value={draft.side} onChange={(e) => set('side', e.target.value)}>
          <option value="both">Los dos</option><option value="long">Solo alcista</option><option value="short">Solo bajista</option>
        </select>
      </div>
      <div className="setting-row">
        <label>Cómo se combinan</label>
        <select value={draft.mode} onChange={(e) => set('mode', e.target.value)}>
          {SETUP_MODES.map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
        </select>
      </div>
      {draft.mode === 'threshold' && (
        <div className="setting-row"><label>Mínimo de casillas</label><input type="number" min="1" max="6" value={draft.min} onChange={(e) => set('min', e.target.value)} /></div>
      )}
      <div className="setting-row">
        <label>Ventana (velas)</label>
        <input type="number" min="1" max="5" value={draft.window} onChange={(e) => set('window', e.target.value)} />
        <span className="hint">1 = misma vela. La vela que dispara siempre aporta un voto.</span>
      </div>
      <p className="hint" style={{ margin: '6px 0' }}>Casillas: uno o más códigos separados por "|" (cualquiera vale). En grupos o secuencia, el número de grupo ordena los pasos: el último grupo es el que dispara.</p>
      {draft.slots.map((slot, k) => (
        <div key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <input type="text" value={slot.text} onChange={(e) => setSlot(k, 'text', e.target.value)} style={{ flex: 1 }} placeholder="SW|BR" />
          {(draft.mode === 'groups' || draft.mode === 'sequence') && (
            <input type="number" min="0" max="3" value={slot.group} onChange={(e) => setSlot(k, 'group', e.target.value)} style={{ width: 50 }} title="Grupo" />
          )}
          <button className="btn-secondary" onClick={() => set('slots', draft.slots.filter((_, j) => j !== k))}>×</button>
        </div>
      ))}
      {draft.slots.length < 6 && <button className="btn-secondary" onClick={() => set('slots', [...draft.slots, { text: '', group: 0 }])}>+ Casilla</button>}
      <p className="hint" style={{ margin: '6px 0', fontSize: 10 }}>{CODES_HINT}</p>
      <div className="setting-row"><label className="checkbox-label"><input type="checkbox" checked={!!draft.momentum} onChange={(e) => set('momentum', e.target.checked)} />Momentum: EMA 14 con pendiente a favor y el precio de su lado</label></div>
      <div className="setting-row">
        <label className="checkbox-label"><input type="checkbox" checked={!!draft.swing?.on} onChange={(e) => setNested('swing', 'on', e.target.checked)} />Swing: mínimo o máximo de</label>
        <input type="number" min="2" max="20" value={draft.swing?.bars ?? 5} onChange={(e) => setNested('swing', 'bars', e.target.value)} style={{ width: 50 }} />
        <span className="hint">velas, hasta</span>
        <input type="number" min="0" max="5" value={draft.swing?.flex ?? 0} onChange={(e) => setNested('swing', 'flex', e.target.value)} style={{ width: 50 }} />
        <span className="hint">velas antes</span>
      </div>
      <div className="setting-row"><label className="checkbox-label"><input type="checkbox" checked={!!draft.swing?.onSwing} onChange={(e) => setNested('swing', 'onSwing', e.target.checked)} />Un voto en la vela del swing</label></div>
      <div className="setting-row">
        <label className="checkbox-label"><input type="checkbox" checked={!!draft.entry?.on} onChange={(e) => setNested('entry', 'on', e.target.checked)} />Confirmar la entrada: el precio avanza</label>
        <input type="number" min="0.05" max="3" step="0.05" value={draft.entry?.atr ?? 0.25} onChange={(e) => setNested('entry', 'atr', e.target.value)} style={{ width: 60 }} />
        <span className="hint">ATR a favor dentro de</span>
        <input type="number" min="1" max="5" value={draft.entry?.bars ?? 2} onChange={(e) => setNested('entry', 'bars', e.target.value)} style={{ width: 50 }} />
        <span className="hint">velas</span>
      </div>
      {error && <p className="hint" style={{ color: '#C62828' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn-primary" onClick={() => { const out = build(); if (out) onSave(out); }}>Guardar</button>
        {recipe.builtin && <button className="btn-secondary" onClick={() => { const out = build(); if (out) onSaveAsNew(out); }}>Guardar como propia</button>}
        <button className="btn-secondary" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

/** Setups de Orderflows Unlocked: cuáles se ven, su evaluación en el histórico y recetas propias */
const OrderFlowSetupsSettings = ({ symbol, indicator, onApply, onClose }) => {
  const [config, setConfig] = useState(() => JSON.parse(JSON.stringify(indicator.setupsConfig)));
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [results, setResults] = useState({});
  const [rules, setRules] = useState({ days: 180, stop_atr: 1.5, target_r: 2, horizon: 96 });
  const [batch, setBatch] = useState(null);
  const stopBatch = useRef(false);

  const recipes = useMemo(() => allRecipes(config), [config]);
  const active = new Set(config.active || []);
  const shown = recipes.filter(recipe => {
    if (filter === 'active') return active.has(recipe.id);
    if (filter === 'custom') return !recipe.builtin;
    if (filter === 'giro' || filter === 'continuación') return recipe.kind === filter;
    return true;
  });

  const toggle = (id) => setConfig(previous => {
    const set = new Set(previous.active || []);
    if (set.has(id)) set.delete(id); else set.add(id);
    return { ...previous, active: [...set] };
  });

  const evaluate = async (recipe) => {
    setResults(previous => ({ ...previous, [recipe.id]: { loading: true } }));
    try {
      const response = await fetch(`${API_BASE_URL}/api/orderflow/setups/${symbol}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interval: String(indicator.tfMinutes), recipe, known_until: Math.round(indicator.clock || Date.now()),
          target: indicator.config.target / 100, vol_filter: indicator.config.volFilter, ...rules
        })
      });
      const data = await response.json();
      setResults(previous => ({ ...previous, [recipe.id]: data.success ? data : { error: data.message || 'No se pudo evaluar' } }));
      return data;
    } catch (error) {
      setResults(previous => ({ ...previous, [recipe.id]: { error: error.message } }));
      return null;
    }
  };

  const evaluateShown = async () => {
    stopBatch.current = false;
    const list = shown.filter(recipe => !recipe.missing?.length || recipe.slots.length);
    for (let k = 0; k < list.length; k++) {
      if (stopBatch.current) break;
      setBatch(`${k + 1} de ${list.length}`);
      await evaluate(list[k]);
    }
    setBatch(null);
  };

  const sortByEdge = () => {
    const order = new Map(recipes.map(recipe => [recipe.id, results[recipe.id]?.edgeR ?? -Infinity]));
    setFilter('all');
    setConfig(previous => ({ ...previous, sortedBy: [...order.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id) }));
  };
  const ordered = config.sortedBy ? [...shown].sort((a, b) => config.sortedBy.indexOf(a.id) - config.sortedBy.indexOf(b.id)) : shown;

  const saveRecipe = (recipe) => {
    setConfig(previous => {
      if (recipe.builtin) {
        const base = SETUP_LIBRARY.find(item => item.id === recipe.id);
        const { name, side, mode, min, groupMins, window, slots, momentum, swing, entry } = recipe;
        return { ...previous, overrides: { ...previous.overrides, [recipe.id]: { name: name || base.name, side, mode, min, groupMins, window, slots, momentum, swing, entry } } };
      }
      const custom = (previous.custom || []).filter(item => item.id !== recipe.id);
      return { ...previous, custom: [...custom, recipe] };
    });
    setEditing(null);
  };

  const saveAsNew = (recipe) => {
    const id = `R${Date.now()}`;
    const copy = { ...recipe, id, builtin: false, num: undefined, name: `${recipe.name} (propia)`, kind: recipe.kind };
    setConfig(previous => ({ ...previous, custom: [...(previous.custom || []), copy], active: [...(previous.active || []), id] }));
    setEditing(null);
  };

  const removeCustom = (id) => setConfig(previous => ({
    ...previous, custom: (previous.custom || []).filter(item => item.id !== id), active: (previous.active || []).filter(item => item !== id)
  }));

  const restore = (id) => setConfig(previous => {
    const overrides = { ...previous.overrides };
    delete overrides[id];
    return { ...previous, overrides };
  });

  const handleApply = () => {
    const clean = { ...config, sortedBy: undefined };
    saveSetupsConfig(symbol, clean);
    onApply(clean);
    onClose();
  };

  return (
    <div className="indicator-settings-overlay">
      <div className="indicator-settings-modal" style={{ maxWidth: 900, width: '92vw' }}>
        <div className="settings-header">
          <h3>Setups de Order Flow - {symbol}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <p className="hint" style={{ margin: 0 }}>
              Cada setup es una receta de Elementos OF: qué elementos deben coincidir, en la misma vela o en una ventana, y en qué orden.
              Leídas de las láminas de Orderflows Unlocked, que no traen entrada, stop ni resultados: son hipótesis.
              "Evaluar" corre la receta en los días anteriores a la hora simulada, entrando al cierre de la vela que la completa,
              con comisión taker de entrada y salida, contra la base de las velas del mismo color con las mismas reglas.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
              <span className="hint">Días</span>
              <input type="number" min="7" max="730" value={rules.days} onChange={(e) => setRules({ ...rules, days: Number(e.target.value) })} style={{ width: 70 }} />
              <span className="hint">Stop (ATR)</span>
              <input type="number" min="0.25" max="5" step="0.25" value={rules.stop_atr} onChange={(e) => setRules({ ...rules, stop_atr: Number(e.target.value) })} style={{ width: 60 }} />
              <span className="hint">Objetivo (R)</span>
              <input type="number" min="0.5" max="10" step="0.5" value={rules.target_r} onChange={(e) => setRules({ ...rules, target_r: Number(e.target.value) })} style={{ width: 60 }} />
              <span className="hint">Horizonte (velas)</span>
              <input type="number" min="4" max="500" value={rules.horizon} onChange={(e) => setRules({ ...rules, horizon: Number(e.target.value) })} style={{ width: 70 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {FILTERS.map(([key, label]) => (
                <button key={key} className={filter === key ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter(key)}>{label}</button>
              ))}
              {batch ? <button className="btn-secondary" onClick={() => { stopBatch.current = true; }}>Detener ({batch})</button>
                : <button className="btn-secondary" onClick={evaluateShown}>Evaluar los {shown.length} de la lista</button>}
              <button className="btn-secondary" onClick={sortByEdge}>Ordenar por ventaja</button>
              <button className="btn-secondary" onClick={() => setEditing(cleanRecipe({ id: `R${Date.now()}`, name: 'Receta propia', slots: [{ codes: ['EX'] }], mode: 'strict', window: 1 }))}>+ Receta propia</button>
            </div>
          </div>

          {editing && <RecipeEditor recipe={editing} onSave={saveRecipe} onSaveAsNew={saveAsNew} onCancel={() => setEditing(null)} />}

          <div className="settings-section">
            {ordered.map(recipe => (
              <div key={recipe.id} style={{ borderBottom: '1px solid #ECEFF1', padding: '5px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={active.has(recipe.id)} onChange={() => toggle(recipe.id)} />
                  <strong style={{ width: 38 }}>{recipeLabel(recipe)}</strong>
                  <span style={{ flex: 1 }}>
                    {recipe.name}
                    <span className="hint" style={{ marginLeft: 6 }}>{recipeText(recipe)} · {recipe.kind || 'propia'}</span>
                    {recipe.missing?.length ? <span className="hint" style={{ marginLeft: 6, color: '#B26A00' }}>sin {recipe.missing.join(', ')}</span> : null}
                    {config.overrides?.[recipe.id] ? <span className="hint" style={{ marginLeft: 6, color: '#1565C0' }}>editado</span> : null}
                  </span>
                  <button className="btn-secondary" onClick={() => evaluate(recipe)}>Evaluar</button>
                  <button className="btn-secondary" onClick={() => setEditing(recipe)}>Editar</button>
                  {recipe.builtin && config.overrides?.[recipe.id] && <button className="btn-secondary" onClick={() => restore(recipe.id)}>Del libro</button>}
                  {!recipe.builtin && <button className="btn-secondary" onClick={() => removeCustom(recipe.id)}>Quitar</button>}
                </div>
                <div style={{ marginLeft: 54 }}><EvalLine result={results[recipe.id]} /></div>
              </div>
            ))}
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={() => setConfig(previous => ({ ...previous, active: [] }))}>Apagar todos</button>
          <button className="btn-primary" onClick={handleApply}>Aplicar y cerrar</button>
        </div>
      </div>
    </div>
  );
};

export default OrderFlowSetupsSettings;
