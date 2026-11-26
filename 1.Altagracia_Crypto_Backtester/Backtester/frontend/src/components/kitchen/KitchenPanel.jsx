// La cocina de estrategias en la simulación manual (26/11/2026, paso 1.1 de docs/PLAN_CENTRAL_ESTRATEGIAS.md).
// Abre en blanco. El usuario reproduce, pausa donde ve algo, hace clic en esa vela y suma lo que se cumple ahí al
// contexto o a un paso del gatillo. El backend (kitchen.py) dice dónde se cumple cada cosa en lo ya recorrido, solo con
// velas cerradas en la hora simulada. No abre órdenes ni avisa al reproducir: eso llega con el paso 1.3.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isBlind, maskDate, priceText, volumeText } from '../backtesting/blindClock.js';
import { TF_MS, lastClosedIndex } from '../backtesting/replayClock.js';
import { BLOCK_FAMILIES, EVENT, LINE_OPTIONS, STATE, allBlocks, blockDef, blockText, kindIn, protoOf } from './kitchenCatalog.js';
import {
  MAX_STEPS, SIDE_NAMES, TF_MINUTES, VIEW_BARS, addBlock, addStep, allBlocksOf, blankDoc, candleVerdict, closedWindow, docForEngine, draftKey,
  isBlank, kitchenBands, loadStore, mirrored, normalizeDoc, phrase, placeFor, relativeDir, removeBlock, removeStep, saveStore, setLink, setParam,
  setStep, editBlock, withSide, withVersion, withoutStrategy
} from './kitchenDoc.js';
import { evaluateKitchen } from './kitchenApi.js';
import { HelpCard, HelpToggle } from './KitchenHelp.jsx';
import './Kitchen.css';

const PLAYING_GAP_MS = 1200;   // Mientras reproduce: a lo sumo un pedido cada tanto
const PAUSED_GAP_MS = 120;
const HELP_KEY = 'kitchen_help_v1';

const number = (n) => Number(n || 0).toLocaleString('es-CO');
const candles = (n) => `${number(n)} ${Number(n) === 1 ? 'vela' : 'velas'}`;
const times = (n) => `${number(n)} ${Number(n) === 1 ? 'vez' : 'veces'}`;

function when(timestamp) {
  if (isBlind()) return maskDate(timestamp);
  return new Date(timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function loadDraft(symbol) {
  try {
    const raw = JSON.parse(localStorage.getItem(draftKey(symbol)) || 'null');
    return { doc: normalizeDoc(raw?.doc), name: raw?.name || '', id: raw?.id || null, version: raw?.version || 0 };
  } catch {
    return { doc: blankDoc(), name: '', id: null, version: 0 };
  }
}

function loadHelp() {
  try {
    return JSON.parse(localStorage.getItem(HELP_KEY) || 'null') || { general: true };
  } catch {
    return { general: true };
  }
}

/** Lo que dice el motor de un bloque en lo recorrido */
function countText(block, info, seen) {
  if (!info) return '';
  return kindIn(block) === STATE ? `${number(info.count)} de ${candles(seen)}` : times(info.count);
}

const Field = ({ label, children }) => (
  <label className="kt-field"><span>{label}</span>{children}</label>
);

/** Un bloque dentro de una capa: su texto, cuántas veces se cumple y, abierto, lo que se le puede cambiar */
const Chip = ({ block, side, info, seen, open, onOpen, onChange, onRemove }) => {
  const def = blockDef(block.id);
  const kind = kindIn(block);
  return (
    <div className={`kt-chip-box${open ? ' open' : ''}`}>
      <div className="kt-chip-row">
        <button type="button" className={`kt-chip ${kind === STATE ? 'state' : 'event'}`} onClick={onOpen}
          title={`${def?.help || ''} Un clic lo resalta en el gráfico y abre sus opciones.`}>
          {blockText(block, side)}
        </button>
        <span className="kt-count">{countText(block, info, seen)}</span>
        <button type="button" className="kt-x" onClick={onRemove} title="Quitar este bloque" aria-label="Quitar este bloque">×</button>
      </div>
      {open && (
        <div className="kt-chip-edit">
          {def?.sided && (
            <button type="button" className="btn-quick" onClick={() => onChange(b => ({ ...b, p: { ...b.p, dir: b.p.dir === 'contra' ? 'favor' : 'contra' } }))}>
              Dar vuelta: {block.p.dir === 'contra' ? 'ahora va en contra del trade' : 'ahora va a favor del trade'}
            </button>
          )}
          {(def?.lines || []).map(([key, label]) => (
            <Field key={key} label={label}>
              <select value={block.p[key]} onChange={e => onChange(b => ({ ...b, p: { ...b.p, [key]: e.target.value } }))}>
                {LINE_OPTIONS.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
              </select>
            </Field>
          ))}
          {(def?.fields || []).map(([key, label, min, max, step]) => (
            <Field key={key} label={label}>
              <input type="number" min={min} max={max} step={step} value={block.p[key]}
                onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value) && e.target.value !== '') onChange(b => ({ ...b, p: { ...b.p, [key]: Math.max(min, Math.min(max, value)) } })); }} />
            </Field>
          ))}
          {block.conv === 'recent' && (
            <Field label="Cuenta si ocurrió en las últimas (velas)">
              <input type="number" min={1} max={50} step={1} value={block.cn}
                onChange={e => { const value = Number(e.target.value); if (value >= 1) onChange(b => ({ ...b, cn: Math.min(50, Math.round(value)) })); }} />
            </Field>
          )}
          <div className="kt-note">{def?.help}{def?.shown ? ` En el gráfico lo dibuja el indicador «${def.shown}».` : ''}</div>
        </div>
      )}
    </div>
  );
};

/** Una fila de lo que hay en la vela elegida, con sus botones para sumarlo */
const Offer = ({ item, doc, side, at, tfMs, onAdd, used }) => {
  const def = blockDef(item.id);
  if (!def) return null;
  const natural = placeFor(doc, def, at, tfMs);
  const other = placeFor(doc, def, at, tfMs, true);
  const name = (place) => (place.kind === 'ctx' ? 'Contexto' : place.isNew ? 'Paso nuevo' : `Paso ${place.index + 1}`);
  return (
    <div className="kt-offer">
      <div className="kt-offer-text">
        <span className={`kt-chip ${def.kind === STATE ? 'state' : 'event'} flat`}>{blockText(item, side)}</span>
        {item.note && <span className="kt-count">{item.note}</span>}
      </div>
      {used ? <span className="kt-count">Ya está</span> : (
        <div className="kt-offer-actions">
          <button type="button" className="btn-quick kt-main" onClick={() => onAdd('auto', item)} aria-label={`${name(natural)}: ${blockText(item, side)}`}>{name(natural)}</button>
          <button type="button" className="btn-quick" onClick={() => onAdd('alt', item)} aria-label={`${name(other)}: ${blockText(item, side)}`}>{name(other)}</button>
        </div>
      )}
    </div>
  );
};

export default function KitchenPanel({ symbol, timeframe, getCandles, currentTime, isPlaying, picked, onBands }) {
  const draft = useMemo(() => loadDraft(symbol), [symbol]);
  const [doc, setDoc] = useState(draft.doc);
  const [name, setName] = useState(draft.name);
  const [savedAs, setSavedAs] = useState({ id: draft.id, version: draft.version });
  const [viewSide, setViewSide] = useState('short');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(null);       // El bloque abierto: se resalta en su propia fila del gráfico
  const [pick, setPick] = useState(null);         // Hora de la vela elegida en el gráfico
  const [pickNote, setPickNote] = useState(null);
  const [help, setHelp] = useState(loadHelp);
  const [store, setStore] = useState(() => loadStore());
  const [palette, setPalette] = useState(false);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState(null);
  const [candleInfo, setCandleInfo] = useState(null);   // Lo que el motor dijo de la vela elegida
  const candleRef = useRef(null);
  const requestRef = useRef({ controller: null, timer: null, lastAt: 0, serial: 0 });

  const tfMs = TF_MS[timeframe];
  const side = doc.side;
  const main = getCandles?.() || [];
  const lastIndex = Number.isFinite(currentTime) ? lastClosedIndex(main, timeframe, currentTime) : -1;
  const lastTime = lastIndex >= 0 ? main[lastIndex].timestamp : null;
  const engineDoc = useMemo(() => JSON.stringify(docForEngine(doc)), [doc]);

  // El borrador sigue ahí al cambiar de pestaña o recargar
  useEffect(() => {
    try {
      localStorage.setItem(draftKey(symbol), JSON.stringify({ doc, name, id: savedAs.id, version: savedAs.version }));
    } catch { /* Sin espacio: el borrador queda solo en la pantalla */ }
  }, [symbol, doc, name, savedAs]);

  useEffect(() => {
    try { localStorage.setItem(HELP_KEY, JSON.stringify(help)); } catch { /* Solo es la ayuda */ }
  }, [help]);

  // Un clic en una vela del gráfico. La vela en formación no cuenta: se toma la última cerrada
  useEffect(() => {
    if (!picked || !Number.isFinite(picked.time)) return;
    if (lastTime === null) return;
    if (picked.time > lastTime) {
      setPick(lastTime);
      setPickNote('Esa vela todavía se está formando: se muestra la última cerrada.');
    } else {
      setPick(picked.time);
      setPickNote(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);

  // Si la simulación retrocede, la vela elegida puede quedar en el futuro: se suelta
  useEffect(() => {
    if (pick !== null && lastTime !== null && pick > lastTime) setPick(null);
  }, [pick, lastTime]);

  // Pide al motor lo que se cumple en lo recorrido: al cambiar la estrategia, al cerrar una vela o al elegir una.
  // Con la cocina en blanco y sin vela elegida no hay nada que pedir
  const blank = isBlank(doc);
  useEffect(() => {
    const state = requestRef.current;
    if (lastTime === null) return undefined;
    if (blank && pick === null) {
      state.controller?.abort();
      state.serial += 1;
      setResult(null);
      setBusy(false);
      return undefined;
    }
    // Lo que hay en una vela ya cerrada no cambia al avanzar: mientras reproduce se pide una sola vez
    const askPick = pick !== null && (!isPlaying || candleRef.current?.t !== pick) ? pick : null;
    const run = async () => {
      state.timer = null;
      const window_ = closedWindow(getCandles?.() || [], timeframe, currentTime, VIEW_BARS);
      if (!window_) return;
      state.controller?.abort();
      const controller = new AbortController();
      state.controller = controller;
      const serial = ++state.serial;
      state.lastAt = Date.now();
      setBusy(true);
      try {
        const data = await evaluateKitchen(symbol, {
          tf: TF_MINUTES[timeframe], candles: window_.rows, view: window_.view, doc: JSON.parse(engineDoc),
          pick: askPick !== null && askPick >= window_.rows[window_.rows.length - window_.view][0] ? askPick : null
        }, controller.signal);
        if (serial !== state.serial) return;
        setResult({ ...data, tfName: timeframe });
        if (data.candle) {
          candleRef.current = data.candle;
          setCandleInfo(data.candle);
        }
        setError(null);
      } catch (problem) {
        if (problem.name === 'AbortError' || serial !== state.serial) return;
        setError(problem.message || 'No se pudo consultar el backend');
      } finally {
        if (serial === state.serial) setBusy(false);
      }
    };
    const gap = isPlaying ? PLAYING_GAP_MS : PAUSED_GAP_MS;
    const wait = Math.max(isPlaying ? 0 : PAUSED_GAP_MS, state.lastAt + gap - Date.now());
    clearTimeout(state.timer);
    state.timer = setTimeout(run, wait);
    return () => clearTimeout(state.timer);
    // currentTime no va: solo importa cuando cierra una vela (lastTime)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe, engineDoc, blank, lastTime, pick, isPlaying]);

  useEffect(() => () => { requestRef.current.controller?.abort(); }, []);

  // Otra moneda u otro marco: lo calculado ya no vale
  useEffect(() => { setResult(null); setPick(null); setFocus(null); setCandleInfo(null); candleRef.current = null; }, [symbol, timeframe]);

  const fresh = result && result.tfName === timeframe ? result : null;
  const focusBlock = focus ? allBlocksOf(doc).find(block => block.uid === focus) : null;

  // Lo que se pinta en el gráfico: una fila por capa, las señales, las líneas y la vela elegida
  useEffect(() => {
    onBands?.(kitchenBands(fresh, { tf: timeframe, pick, focus: focusBlock ? focus : null, focusText: focusBlock ? blockText(focusBlock, side) : '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh, pick, focus, timeframe, side, doc]);
  useEffect(() => () => onBands?.([]), []);   // eslint-disable-line react-hooks/exhaustive-deps

  const change = useCallback((next) => { setDoc(next); setNotice(null); }, []);
  const toggleHelp = (id) => setHelp(current => ({ ...current, [id]: !current[id] }));
  const seen = fresh?.seen || 0;
  const candle = candleInfo && candleInfo.t === pick ? candleInfo : null;
  const expressSide = side === 'both' ? viewSide : side;

  const offered = (item) => {
    const def = blockDef(item.id);
    const p = { ...item.p, ...(def?.sided ? { dir: relativeDir(item.d || 1, side, viewSide) } : {}) };
    const parts = [];
    if (item.obs?.atr !== undefined) parts.push(`ahora, ${item.obs.atr} ATR`);
    if (item.obs?.meter !== undefined) parts.push(`ahora, ${item.obs.meter > 0 ? '+' : ''}${item.obs.meter}`);
    if (item.late) parts.push(`se supo ${candles(item.late)} después`);
    return { id: item.id, p, note: parts.join(' · ') };
  };
  const isUsed = (item) => allBlocksOf(doc).some(block => block.id === item.id && JSON.stringify(block.p) === JSON.stringify({ ...blockDef(item.id).p, ...item.p }));
  const addFromCandle = (target, item) => {
    const at = pick + (item.lateMs || 0);
    change(addBlock(doc, target, { id: item.id, p: item.p }, at, tfMs));
  };

  const pickedCandle = pick !== null ? main[lastClosedIndex(main, timeframe, pick + tfMs)] : null;
  const verdicts = candleVerdict(candle, doc);
  const stepsInfo = fresh?.steps || [];
  const usedSteps = doc.gat.map((step, i) => (step.blocks.length ? i : -1)).filter(i => i >= 0);
  const infoOfStep = (index) => stepsInfo[usedSteps.indexOf(index)] || null;

  const save = () => {
    const out = withVersion(store, { id: savedAs.id, name, symbol, tf: timeframe }, doc);
    if (!out.saved) { setNotice(`Sin cambios: ya está guardada como la versión ${out.version}.`); return; }
    if (!saveStore(out.store)) { setNotice('No se pudo guardar: el navegador no tiene espacio.'); return; }
    setStore(out.store);
    setSavedAs({ id: out.id, version: out.version });
    setNotice(`Guardada como la versión ${out.version}.`);
  };
  const open = (item, version) => {
    if (!isBlank(doc) && !window.confirm('Se reemplaza lo que hay en la cocina por la estrategia guardada. ¿Seguir?')) return;
    change(normalizeDoc(version.doc));
    setName(item.name);
    setSavedAs({ id: item.id, version: version.v });
    setFocus(null);
  };
  const drop = (item) => {
    if (!window.confirm(`Se borra «${item.name}» con sus ${item.versions.length} versiones. No se puede deshacer. ¿Borrarla?`)) return;
    const next = withoutStrategy(store, item.id);
    if (saveStore(next)) setStore(next);
    if (savedAs.id === item.id) setSavedAs({ id: null, version: 0 });
  };
  const empty = () => {
    if (!isBlank(doc) && !window.confirm('Se vacía la cocina. Lo que no esté guardado como versión se pierde. ¿Vaciar?')) return;
    change(blankDoc());
    setName('');
    setSavedAs({ id: null, version: 0 });
    setFocus(null);
  };

  const found = useMemo(() => {
    const text = search.trim().toLowerCase();
    return allBlocks().filter(def => !text || def.name.toLowerCase().includes(text) || blockText(protoOf(def.id), expressSide).toLowerCase().includes(text));
  }, [search, expressSide]);

  const chip = (block) => (
    <Chip key={block.uid} block={block} side={side} info={fresh?.blocks?.[block.uid]} seen={seen} open={focus === block.uid}
      onOpen={() => setFocus(current => (current === block.uid ? null : block.uid))}
      onChange={fn => change(editBlock(doc, block.uid, fn))}
      onRemove={() => { change(removeBlock(doc, block.uid)); if (focus === block.uid) setFocus(null); }} />
  );

  return (
    <div className="kt-panel">
      <div className="kt-head">
        <h3>Cocina de estrategias</h3>
        <HelpToggle open={!!help.general} onClick={() => toggleHelp('general')} />
      </div>
      {help.general && (
        <>
          <HelpCard id="general" />
          <HelpCard id="elegir" />
        </>
      )}

      {error && <div className="kt-error">{error}</div>}
      {lastTime === null && <div className="kt-note">Todavía no cerró ninguna vela en este marco: avanza la simulación.</div>}

      <div className="kt-row">
        <span className="kt-label">Busco</span>
        {['short', 'long', 'both'].map(value => (
          <button key={value} type="button" className={`kt-seg${side === value ? ' on' : ''}`} onClick={() => change(withSide(doc, value))}>{SIDE_NAMES[value]}</button>
        ))}
      </div>
      {side === 'both' && (
        <div className="kt-row">
          <span className="kt-label">Lo que elijo lo estoy viendo para un</span>
          {['short', 'long'].map(value => (
            <button key={value} type="button" className={`kt-seg${viewSide === value ? ' on' : ''}`} onClick={() => setViewSide(value)}>{value === 'short' ? 'corto' : 'largo'}</button>
          ))}
        </div>
      )}

      <div className="kt-legend">
        <span className="kt-chip state flat">estado</span><span>se cumple vela tras vela</span>
        <span className="kt-chip event flat">evento</span><span>ocurre en una vela</span>
      </div>

      <div className="kt-phrase">{phrase(doc)}</div>

      {pick !== null && (
        <div className="kt-card pick">
          <div className="kt-card-head">
            <strong>¿Qué hay en la vela del {when(pick)}?</strong>
            <button type="button" className="kt-x" onClick={() => setPick(null)} title="Soltar esta vela" aria-label="Soltar esta vela">×</button>
          </div>
          {pickNote && <div className="kt-note">{pickNote}</div>}
          {pickedCandle && pickedCandle.timestamp === pick && (
            <div className="kt-note">
              Cierre {priceText(pickedCandle.close, 2)}{candle?.rangeAtr !== null && candle?.rangeAtr !== undefined ? ` · rango de ${candle.rangeAtr} ATR` : ''} · volumen {volumeText(pickedCandle.volume)}
            </div>
          )}
          {!candle && <div className="kt-note">{!busy && fresh && pick < fresh.times[0] ? `Esa vela queda antes de las últimas ${candles(seen)}: elige una más reciente.` : 'Mirando esa vela…'}</div>}
          {verdicts.map(verdict => (
            <div key={verdict.side} className={`kt-verdict${verdict.signal ? ' yes' : verdict.near ? ' near' : ''}`}>
              <strong>{verdict.title}</strong>
              {verdict.lines.map((line, i) => <div key={i} className={line.ok ? 'ok' : 'no'}>{line.ok ? '✓' : '✗'} {line.text}</div>)}
            </div>
          ))}
          {candle && (
            <>
              <div className="kt-sub">Eventos de esta vela · {candle.events.length}</div>
              {!candle.events.length && <div className="kt-note">Ninguno de los que la cocina conoce.</div>}
              {candle.events.map((item, i) => {
                const offer = { ...offered(item), lateMs: (item.late || 0) * tfMs };
                return <Offer key={`e${i}`} item={offer} doc={doc} side={side} at={pick + offer.lateMs} tfMs={tfMs} onAdd={addFromCandle} used={isUsed(offer)} />;
              })}
              <div className="kt-sub">Estados que se cumplen aquí · {candle.states.length}</div>
              {candle.states.map((item, i) => {
                const offer = offered(item);
                return <Offer key={`s${i}`} item={offer} doc={doc} side={side} at={pick} tfMs={tfMs} onAdd={addFromCandle} used={isUsed(offer)} />;
              })}
              <div className="kt-note">El primer botón es donde le toca por su vela: lo de una misma vela va junto, y lo de una vela posterior, a un paso después.</div>
            </>
          )}
        </div>
      )}
      {pick === null && lastTime !== null && (
        <div className="kt-hint">Haz clic en una vela del gráfico para ver lo que se cumple en ella y sumarlo.</div>
      )}

      <div className="kt-layer">
        <div className="kt-layer-head">
          <strong>Capa 1 · Contexto <span>· lo que ya venía pasando</span></strong>
          <HelpToggle open={!!help.contexto} onClick={() => toggleHelp('contexto')} />
        </div>
        {help.contexto && <HelpCard id="contexto" />}
        {!doc.ctx.length && <div className="kt-empty">Aquí van los estados</div>}
        {doc.ctx.map(chip)}
        {doc.ctx.length > 0 && (
          <div className="kt-row small">
            <span className="kt-label">Se mira</span>
            <select value={doc.ctxWhen} onChange={e => change({ ...doc, ctxWhen: e.target.value })}>
              <option value="first">mientras se junta el paso 1</option>
              <option value="last">en la señal</option>
            </select>
            {fresh?.context?.has && <span className="kt-count">se cumple en {number(fresh.context.count)} de {candles(seen)}</span>}
          </div>
        )}
      </div>

      <div className="kt-layer">
        <div className="kt-layer-head">
          <strong>Capa 2 · Zona <span>· dónde</span></strong>
          <HelpToggle open={!!help.zona} onClick={() => toggleHelp('zona')} />
        </div>
        {help.zona && <HelpCard id="zona" />}
        <div className="kt-empty">Las zonas llegan con el paso 1.2</div>
      </div>

      <div className="kt-layer">
        <div className="kt-layer-head">
          <strong>Capa 3 · Gatillo <span>· qué tiene que pasar</span></strong>
          <HelpToggle open={!!help.gatillo} onClick={() => toggleHelp('gatillo')} />
        </div>
        {help.gatillo && <HelpCard id="gatillo" />}
        {doc.gat.map((step, index) => {
          const info = infoOfStep(index);
          return (
            <React.Fragment key={index}>
              {index > 0 && (
                <div className="kt-link">
                  <span>↓</span>
                  <select value={doc.links[index - 1]?.type || 'after'} onChange={e => change(setLink(doc, index - 1, { type: e.target.value }))}>
                    <option value="after">después</option>
                    <option value="same">al tiempo o después</option>
                    <option value="any">en cualquier orden</option>
                  </select>
                  <span>, hasta</span>
                  <input type="number" min={1} max={60} value={doc.links[index - 1]?.max || 5}
                    onChange={e => { const value = Number(e.target.value); if (value >= 1) change(setLink(doc, index - 1, { max: Math.min(60, Math.round(value)) })); }} />
                  <span>velas</span>
                </div>
              )}
              <div className="kt-step">
                <div className="kt-step-head">
                  <strong>Paso {index + 1}</strong>
                  {index === 0 && <HelpToggle open={!!help.paso} onClick={() => toggleHelp('paso')} label="¿Qué es un paso?" />}
                  {(doc.gat.length > 1 || step.blocks.length > 0) && (
                    <button type="button" className="kt-x" onClick={() => change(removeStep(doc, index))} title="Quitar este paso con lo que tiene" aria-label="Quitar este paso">×</button>
                  )}
                </div>
                {index === 0 && help.paso && <HelpCard id="paso" />}
                {!step.blocks.length && <div className="kt-empty">Aquí van los eventos{index === 0 ? ': lo primero que tiene que ocurrir' : ''}</div>}
                {step.blocks.map(chip)}
                {step.blocks.length > 1 && (
                  <div className="kt-row small">
                    <select value={step.mode} onChange={e => change(setStep(doc, index, { mode: e.target.value }))}>
                      <option value="all">todos</option>
                      <option value="min">al menos</option>
                      <option value="any">cualquiera</option>
                    </select>
                    {step.mode === 'min' && (
                      <input type="number" min={1} max={step.blocks.length} value={Math.min(step.min, step.blocks.length)}
                        onChange={e => { const value = Number(e.target.value); if (value >= 1) change(setStep(doc, index, { min: Math.min(step.blocks.length, Math.round(value)) })); }} />
                    )}
                    {step.mode !== 'any' && (
                      <>
                        <span>, en</span>
                        <input type="number" min={1} max={20} value={step.win}
                          onChange={e => { const value = Number(e.target.value); if (value >= 1) change(setStep(doc, index, { win: Math.min(20, Math.round(value)) })); }} />
                        <span>velas</span>
                      </>
                    )}
                  </div>
                )}
                {info && (
                  <div className="kt-count">
                    Se cumple {times(info.done)}{usedSteps.indexOf(index) > 0 || doc.ctx.length ? `; encadenado con lo anterior, ${times(info.reached)}` : ''}
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
        {doc.gat.length < MAX_STEPS && doc.gat[doc.gat.length - 1].blocks.length > 0 && (
          <button type="button" className="btn-quick" onClick={() => change(addStep(doc))}>+ Otro paso</button>
        )}
      </div>

      {fresh && !isBlank(doc) && (
        <div className={`kt-total${fresh.signals.length ? ' yes' : ''}`}>
          {usedSteps.length
            ? <>La estrategia da <strong>{fresh.signals.length === 1 ? '1 señal' : `${number(fresh.signals.length)} señales`}</strong> en las últimas {candles(seen)} de {timeframe}.</>
            : <>Todavía no hay gatillo: el contexto solo no da señales.</>}
          {usedSteps.length > 0 && !fresh.signals.length && <div className="kt-count">Mira en qué paso se corta: es el que tiene pocas o ninguna vez «encadenado».</div>}
          <div className="kt-count">Solo cuenta velas ya cerradas en la hora simulada.{busy ? ' Actualizando…' : ''}</div>
        </div>
      )}

      <div className="kt-layer">
        <div className="kt-layer-head">
          <strong>Buscar un bloque <span>· lo que no está a la vista</span></strong>
          <button type="button" className="kt-help-toggle" onClick={() => setPalette(value => !value)}>{palette ? 'Cerrar' : 'Abrir'}</button>
        </div>
        {palette && (
          <>
            <input className="kt-search" type="search" placeholder="Buscar: EMA, volumen, martillo…" value={search} onChange={e => setSearch(e.target.value)} />
            {BLOCK_FAMILIES.map(family => {
              const list = found.filter(def => def.fam === family.id);
              if (!list.length) return null;
              return (
                <div key={family.id}>
                  <div className="kt-sub">{family.name}</div>
                  {list.map(def => (
                    <div key={def.id} className="kt-offer">
                      <div className="kt-offer-text">
                        <span className={`kt-chip ${def.kind === STATE ? 'state' : 'event'} flat`} title={def.help}>{blockText(protoOf(def.id), expressSide)}</span>
                      </div>
                      <div className="kt-offer-actions">
                        <button type="button" className={`btn-quick${def.kind === STATE ? ' kt-main' : ''}`} onClick={() => change(addBlock(doc, 'ctx', protoOf(def.id), null, tfMs))}>Contexto</button>
                        <button type="button" className={`btn-quick${def.kind === EVENT ? ' kt-main' : ''}`} onClick={() => change(addBlock(doc, 'step', protoOf(def.id), null, tfMs))}>Paso {doc.gat.length}</button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
            <div className="kt-note">Cada bloque entra con sus valores de fábrica: los del backtesting global. Un clic sobre él, ya en su capa, abre lo que se le puede cambiar.</div>
          </>
        )}
      </div>

      <div className="kt-layer">
        <div className="kt-layer-head"><strong>Guardar <span>· cada guardado suma una versión</span></strong></div>
        <div className="kt-row">
          <input className="kt-name" type="text" maxLength={60} placeholder="Nombre de la estrategia" value={name} onChange={e => setName(e.target.value)} />
          <button type="button" className="btn-quick kt-main" disabled={isBlank(doc)} onClick={save}>Guardar versión</button>
        </div>
        <div className="kt-row">
          <button type="button" className="btn-quick" disabled={isBlank(doc)} onClick={() => change(mirrored(doc))} title="Cada bloque pasa a decir lo contrario: lo alcista, bajista">Espejar los bloques</button>
          <button type="button" className="btn-quick" disabled={isBlank(doc)} onClick={empty}>Vaciar la cocina</button>
        </div>
        {notice && <div className="kt-note">{notice}</div>}
        {savedAs.id && <div className="kt-count">En la cocina: «{name || 'Estrategia sin nombre'}», desde su versión {savedAs.version}.</div>}
        {store.list.length > 0 && <div className="kt-sub">Estrategias guardadas</div>}
        {store.list.map(item => {
          const last = item.versions[item.versions.length - 1];
          return (
            <div key={item.id} className="kt-saved">
              <div>
                <strong>{item.name}</strong>
                <div className="kt-count">{item.symbol} · {item.tf} · {item.versions.length === 1 ? '1 versión' : `${item.versions.length} versiones`} · {new Date(last.at).toLocaleDateString('es-CO')}</div>
              </div>
              <div className="kt-offer-actions">
                <select value="" onChange={e => { const version = item.versions.find(v => String(v.v) === e.target.value); if (version) open(item, version); }} aria-label="Abrir una versión">
                  <option value="">Abrir…</option>
                  {[...item.versions].reverse().map(version => <option key={version.v} value={version.v}>versión {version.v} · {new Date(version.at).toLocaleDateString('es-CO')}</option>)}
                </select>
                <button type="button" className="kt-x" onClick={() => drop(item)} title="Borrar esta estrategia y sus versiones" aria-label="Borrar esta estrategia">×</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="kt-note">
        La cocina no abre órdenes ni avisa al reproducir: por ahora pinta dónde se cumple cada capa y cuenta. Lo que valida una estrategia es el backtesting global, no la cocina.
      </div>
    </div>
  );
}
