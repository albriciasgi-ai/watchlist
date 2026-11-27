// La cocina de estrategias en la simulación manual (26/11/2026, pasos 1.1 y 1.2 de docs/PLAN_CENTRAL_ESTRATEGIAS.md).
// Abre en blanco. El usuario reproduce, pausa donde ve algo, hace clic en esa vela y suma lo que se cumple ahí al
// contexto, a la capa de zona o a un paso del gatillo. El backend (kitchen.py) dice dónde se cumple cada cosa en lo ya
// recorrido, solo con velas cerradas en la hora simulada. Los bloques de order flow se detectan en segundo plano:
// mientras tanto la pantalla lo dice y vuelve a preguntar. No abre órdenes ni avisa al reproducir: eso llega con el
// paso 1.3.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isBlind, maskDate, priceText, volumeText } from '../backtesting/blindClock.js';
import { TF_MS, lastClosedIndex } from '../backtesting/replayClock.js';
import {
  BLOCK_FAMILIES, EVENT, LINE_OPTIONS, STATE, VP_PARTS, ZONE_TYPES, allBlocks, blockDef, dirForSeries, dirOptions, isAbsDir, blockText, kindIn, lineLabel, pageSource, pickText, protoOf, zoneName
} from './kitchenCatalog.js';
import {
  MAX_PICKS, MAX_STEPS, SIDE_NAMES, TF_MINUTES, VIEW_BARS, ZONE_NEAR, addBlock, addPick, addStep, allBlocksOf, blankDoc, candleVerdict, closedWindow,
  docForEngine, draftKey, drawnZones, isBlank, kitchenBands, levelLines, levelZones, loadStore, mirrored, normalizeDoc, offersForEngine, phrase, pickFromZone, pickRange,
  placeFor, profileZones, relativeDir, removeBlock, removePick, removeStep, samePick, saveStore, setLink, setParam, setStep, setZone, editBlock,
  withSide, withVersion, withoutStrategy
} from './kitchenDoc.js';
import { evaluateKitchen } from './kitchenApi.js';
import { HelpCard, HelpToggle } from './KitchenHelp.jsx';
import './Kitchen.css';

const PLAYING_GAP_MS = 250;    // Mientras reproduce: a lo sumo un pedido cada tanto, y nunca dos a la vez
const PAUSED_GAP_MS = 120;
const PENDING_GAP_MS = 900;    // Con el order flow detectándose: cada cuánto se vuelve a preguntar
const PROFILES_GAP_MS = 1000;  // Cada cuánto se miran los VP fijos del gráfico: se crean y cambian fuera de esta pestaña
const HELP_KEY = 'kitchen_help_v1';

const number = (n) => Number(n || 0).toLocaleString('es-CO');
const candles = (n) => `${number(n)} ${Number(n) === 1 ? 'vela' : 'velas'}`;
const times = (n) => `${number(n)} ${Number(n) === 1 ? 'vez' : 'veces'}`;
// Un precio para leer: con fecha oculta, el índice; si no, con los decimales que pide su tamaño
const price = (value) => priceText(value, value >= 1000 ? 1 : value >= 10 ? 2 : value >= 1 ? 3 : value >= 0.01 ? 5 : 7);
const FLOW_WAITING = { loading: 'detectando…', none: 'sin almacén de trades', error: 'sin order flow' };

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

/** Lo que dice el motor de un bloque en lo recorrido. Un bloque de order flow que todavía no cuenta lo dice */
function countText(block, info, seen) {
  if (!info) return '';
  if (info.pending) return FLOW_WAITING[info.pending] || '';
  return kindIn(block) === STATE ? `${number(info.count)} de ${candles(seen)}` : times(info.count);
}

/** Lo que dice el motor de una zona elegida en lo recorrido. lastTime: la última vela cerrada; tfMs: lo que dura una vela */
function pickCount(pick, info, lastTime, tfMs) {
  if (!info) return '';
  if (pick.type !== 'one') return info.count === 1 ? '1 zona' : `${number(info.count)} zonas`;
  if (info.count) return info.open ? 'vigente' : 'ya terminó';
  if (lastTime === null || pick.from <= lastTime) return 'no cuenta en lo recorrido';
  // Una zona fija empieza en la primera vela que abre después de sumarla; una que viene de otra fecha, más adelante
  return pick.from <= lastTime + 2 * tfMs ? 'cuenta desde la próxima vela' : 'todavía no cuenta';
}

/** Una zona elegida en la capa de zona: su texto, lo que dice el motor y, abierta, lo que es. Abierta se dibuja en el gráfico */
const ZoneChip = ({ pick, side, info, lastTime, tfMs, open, onOpen, onRemove }) => {
  const type = ZONE_TYPES[pick.kind];
  return (
    <div className={`kt-chip-box${open ? ' open' : ''}`}>
      <div className="kt-chip-row">
        <button type="button" className="kt-chip zone" onClick={onOpen} title={`${type.help} Un clic la resalta en el gráfico.`}>
          {pickText(pick, side, pick.type === 'one' ? pickRange(pick, price) : '')}
        </button>
        <span className="kt-count">{pickCount(pick, info, lastTime, tfMs)}</span>
        <button type="button" className="kt-x" onClick={onRemove} title="Quitar esta zona" aria-label="Quitar esta zona">×</button>
      </div>
      {open && (
        <div className="kt-chip-edit">
          <div className="kt-note">
            {pick.type === 'one'
              ? `Una zona fija: desde el ${when(pick.from)}, solo esta franja de precio. Sirve en la simulación manual; no se puede probar en el histórico.`
              : 'Todas las de este tipo: una regla. Vale para cualquier fecha y después se puede probar en el histórico.'}
            {' '}{type.help}{type.shown ? ` En el gráfico las dibuja el indicador «${type.shown}»; aquí se resaltan mientras esta zona esté abierta.` : ''}
          </div>
        </div>
      )}
    </div>
  );
};

/** Una zona de la vela elegida (o un dibujo), con sus dos maneras de sumarla */
const ZoneOffer = ({ zone, note, used, full, onAll, onOne, oneLabel = 'Solo esta' }) => (
  <div className="kt-offer">
    <div className="kt-offer-text">
      <span className="kt-chip zone flat">{zone.kind === 'draw' ? (zone.lo === zone.hi ? 'Línea dibujada' : 'Zona dibujada') : zoneName(zone)} · {pickRange(zone, price)}</span>
      {note && <span className="kt-count">{note}</span>}
    </div>
    <div className="kt-offer-actions">
      {onAll && (used.all ? <span className="kt-count">Ya están</span>
        : <button type="button" className="btn-quick kt-main" disabled={full} onClick={onAll} title="Todas las zonas de este tipo: una regla, que después se puede probar en el histórico">Todas</button>)}
      {used.one ? <span className="kt-count">Ya está</span>
        : <button type="button" className={`btn-quick${onAll ? '' : ' kt-main'}`} disabled={full} onClick={onOne} title="Solo esta franja de precio: una zona fija, para seguirla en la simulación manual">{oneLabel}</button>}
    </div>
  </div>
);

const Field = ({ label, children }) => (
  <label className="kt-field"><span>{label}</span>{children}</label>
);

/** Un bloque dentro de una capa: su texto, cuántas veces se cumple y, abierto, lo que se le puede cambiar */
const Chip = ({ block, side, info, seen, open, onOpen, onChange, onRemove }) => {
  const def = blockDef(block.id);
  const kind = kindIn(block);
  const select = ([key, label, options]) => (
    <Field key={key} label={label}>
      <select value={block.p[key]} onChange={e => onChange(b => ({ ...b, p: { ...b.p, [key]: e.target.value } }))}>
        {options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select>
    </Field>
  );
  return (
    <div className={`kt-chip-box${open ? ' open' : ''}`}>
      <div className="kt-chip-row">
        <button type="button" className={`kt-chip ${kind === STATE ? 'state' : 'event'}`} onClick={onOpen}
          title={`${def?.help || ''} Un clic lo resalta en el gráfico y abre sus opciones.`}>
          {blockText(block, side)}
        </button>
        <span className="kt-count">{countText(block, info, seen)}</span>
        <button type="button" className={`btn-quick kt-gear${open ? ' on' : ''}`} onClick={onOpen} title="Lo que se le puede cambiar a este bloque: velas, umbrales, sentido" aria-label="Opciones de este bloque">{open ? 'Cerrar' : 'Opciones'}</button>
        <button type="button" className="kt-x" onClick={onRemove} title="Quitar este bloque" aria-label="Quitar este bloque">×</button>
      </div>
      {open && (
        <div className="kt-chip-edit">
          {def?.sided && def?.series && block.id !== 'pmark' && (
            <Field label="Sentido">
              <select value={block.p.dir} onChange={e => onChange(b => ({ ...b, p: { ...b.p, dir: e.target.value } }))}>
                {dirOptions(block.id).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
              </select>
            </Field>
          )}
          {def?.sided && !(def?.series && block.id !== 'pmark') && (
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
          {def?.series && (
            <Field label="Serie del gráfico">
              <select value={block.p.s} onChange={e => onChange(b => ({ ...b, p: { ...b.p, s: e.target.value, dir: dirForSeries(b.id, e.target.value, b.p.dir) } }))}>
                {def.series.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
              </select>
            </Field>
          )}
          {(def?.selects || []).map(select)}
          {(def?.fields || []).map(([key, label, min, max, step]) => (
            <Field key={key} label={label}>
              <input type="number" min={min} max={max} step={step} value={block.p[key]}
                onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value) && e.target.value !== '') onChange(b => ({ ...b, p: { ...b.p, [key]: Math.max(min, Math.min(max, value)) } })); }} />
            </Field>
          ))}
          {(def?.selectsAfter || []).map(select)}
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

export default function KitchenPanel({ symbol, timeframe, getCandles, currentTime, isPlaying, picked, onBands, shapes, getShapes, getProfiles, getPage }) {
  const draft = useMemo(() => loadDraft(symbol), [symbol]);
  const [doc, setDoc] = useState(draft.doc);
  const [name, setName] = useState(draft.name);
  const [savedAs, setSavedAs] = useState({ id: draft.id, version: draft.version });
  const [viewSide, setViewSide] = useState('short');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(null);       // El bloque abierto: se resalta en su propia fila del gráfico
  const [focusZone, setFocusZone] = useState(null);   // La zona abierta: sus franjas se dibujan en el gráfico
  const [pick, setPick] = useState(null);         // Hora de la vela elegida en el gráfico
  const [pickPrice, setPickPrice] = useState(null);   // Y el precio del clic: la zona que quedó debajo va primero
  const [pickNote, setPickNote] = useState(null);
  const [pickLevels, setPickLevels] = useState([]);   // Lo que dibuja el gráfico bajo el clic: niveles y líneas de sus indicadores
  const [missing, setMissing] = useState([]);         // Indicadores apagados que algún bloque necesita
  const [retry, setRetry] = useState(0);          // Cuenta las veces que se volvió a preguntar por el order flow
  const [help, setHelp] = useState(loadHelp);
  const [store, setStore] = useState(() => loadStore());
  const [palette, setPalette] = useState(false);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState(null);
  const [candleInfo, setCandleInfo] = useState(null);   // Lo que el motor dijo de la vela elegida
  const [profilesKey, setProfilesKey] = useState('[]');   // Los VP fijos del gráfico, con sus niveles de ahora
  const candleRef = useRef(null);
  const requestRef = useRef({ controller: null, timer: null, lastAt: 0, serial: 0 });

  const tfMs = TF_MS[timeframe];
  const side = doc.side;
  const main = getCandles?.() || [];
  const lastIndex = Number.isFinite(currentTime) ? lastClosedIndex(main, timeframe, currentTime) : -1;
  const lastTime = lastIndex >= 0 ? main[lastIndex].timestamp : null;
  const engineDoc = useMemo(() => JSON.stringify(docForEngine(doc)), [doc]);

  // Los perfiles de rango fijo los dibuja y los calcula el gráfico, con lo ya ocurrido: se miran cada tanto, porque se
  // crean, se mueven y se recalculan (al avanzar la hora, o al llegar su volumen real) sin pasar por esta pestaña
  useEffect(() => {
    const read = () => {
      let next = '[]';
      try { next = JSON.stringify(getProfiles?.() || []); } catch { /* Sin gráfico todavía */ }
      setProfilesKey(current => (current === next ? current : next));
    };
    read();
    const timer = setInterval(read, PROFILES_GAP_MS);
    return () => clearInterval(timer);
  }, [getProfiles, symbol, timeframe]);
  // Cada nivel cuenta desde ahora (la hora simulada en que se suma), no desde antes: el rango se eligió viendo lo que pasó
  const profiles = useMemo(
    () => profileZones(JSON.parse(profilesKey), Number.isFinite(currentTime) ? currentTime : null),
    [profilesKey, currentTime]
  );
  // Los niveles de los indicadores bajo el clic, con los ajustes de la sesión: zonas fijas que cuentan desde ahora
  const levelOffers = useMemo(() => levelZones(pickLevels, Number.isFinite(currentTime) ? currentTime : null), [pickLevels, currentTime]);
  const pickLines = useMemo(() => levelLines(pickLevels), [pickLevels]);
  const offersRef = useRef([]);
  offersRef.current = [...offersForEngine(profiles), ...levelOffers.map(item => ({ ref: item.id, kind: item.kind, lo: item.lo, hi: item.hi }))];

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
    setPickPrice(Number.isFinite(picked.price) && picked.price > 0 ? picked.price : null);
    setPickLevels(Array.isArray(picked.levels) ? picked.levels : []);
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
      clearTimeout(state.again);
      state.serial += 1;
      state.flight = null;
      setResult(null);
      setBusy(false);
      return undefined;
    }
    // Lo que hay en una vela ya cerrada no cambia al avanzar: mientras reproduce se pide una sola vez, salvo que falte
    // su order flow, que todavía se está detectando
    const known = candleRef.current;
    const askPick = pick !== null && (!isPlaying || known?.t !== pick || known?.flow === 'loading') ? pick : null;
    // Reproduciendo, un pedido a la vez: si cada vela nueva cortara el pedido en curso, a velocidad alta ninguno
    // terminaría y las filas quedarían atrás hasta pausar. El que está en curso termina y enseguida sale otro, con lo último
    const asking = `${engineDoc}|${askPick}|${pickPrice}`;
    if (isPlaying && state.flight === asking) {
      state.queued = true;
      return undefined;
    }
    const run = async () => {
      state.timer = null;
      state.flight = asking;
      state.queued = false;
      clearTimeout(state.again);
      const window_ = closedWindow(getCandles?.() || [], timeframe, currentTime, VIEW_BARS);
      if (!window_) { state.flight = null; return; }
      state.controller?.abort();
      const controller = new AbortController();
      state.controller = controller;
      const serial = ++state.serial;
      state.lastAt = Date.now();
      setBusy(true);
      try {
        const sendPick = askPick !== null && askPick >= window_.rows[window_.rows.length - window_.view][0] ? askPick : null;
        // Lo que calculan los indicadores encendidos del gráfico, con sus ajustes, en lo recorrido
        const tail = window_.rows.slice(-window_.view).map(row => ({ timestamp: row[0], open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] }));
        const page = getPage?.(tail) || null;
        const hasPage = page && ['lines', 'nums', 'marks'].some(group => Object.keys(page[group] || {}).length);
        const lacking = new Set();
        for (const block of allBlocksOf(JSON.parse(engineDoc))) {
          const source = pageSource(block);
          if (!source) continue;
          const keys = block.id === 'pmark' ? [['marks', block.p.s]] : ['psube', 'ppos', 'pgrande', 'pcruza', 'pgiro'].includes(block.id) ? [['nums', block.p.s]]
            : ['line', 'a', 'b'].filter(key => String(block.p[key] || '').startsWith('p:')).map(key => ['lines', block.p[key].slice(2)]);
          if (keys.some(([group, key]) => !page?.[group]?.[key])) lacking.add(source);
        }
        setMissing(previous => (previous.join('|') === [...lacking].join('|') ? previous : [...lacking]));
        const data = await evaluateKitchen(symbol, {
          tf: TF_MINUTES[timeframe], candles: window_.rows, view: window_.view, doc: JSON.parse(engineDoc),
          pick: sendPick, pickPrice: sendPick !== null ? pickPrice : null,
          // Los niveles de los VP fijos del gráfico: el motor los ordena con sus zonas, por cercanía al clic
          ...(sendPick !== null && offersRef.current.length ? { offers: offersRef.current } : {}),
          ...(hasPage ? { page: { lines: page.lines, nums: page.nums, marks: page.marks } } : {}),
          ...(page?.settings && Object.keys(page.settings).length ? { settings: page.settings } : {})
        }, controller.signal);
        if (serial !== state.serial) return;
        setResult({ ...data, tfName: timeframe });
        if (data.candle) {
          candleRef.current = data.candle;
          setCandleInfo(data.candle);
        }
        setError(null);
        // El order flow se detecta en segundo plano: mientras falte, se vuelve a preguntar
        if (data.pending) state.again = setTimeout(() => setRetry(value => value + 1), PENDING_GAP_MS);
      } catch (problem) {
        if (problem.name === 'AbortError' || serial !== state.serial) return;
        setError(problem.message || 'No se pudo consultar el backend');
      } finally {
        if (serial === state.serial) {
          setBusy(false);
          state.flight = null;
          if (state.queued) { state.queued = false; setRetry(value => value + 1); }
        }
      }
    };
    const gap = isPlaying ? PLAYING_GAP_MS : PAUSED_GAP_MS;
    const wait = Math.max(isPlaying ? 0 : PAUSED_GAP_MS, state.lastAt + gap - Date.now());
    clearTimeout(state.timer);
    state.timer = setTimeout(run, wait);
    return () => clearTimeout(state.timer);
    // currentTime no va: solo importa cuando cierra una vela (lastTime). profilesKey: con una vela elegida, sus zonas
    // incluyen los niveles de los VP fijos, que pueden cambiar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe, engineDoc, blank, lastTime, pick, pickPrice, isPlaying, retry, pick !== null ? profilesKey : '']);

  useEffect(() => () => { requestRef.current.controller?.abort(); clearTimeout(requestRef.current.again); }, []);

  // Otra moneda u otro marco: lo calculado ya no vale
  useEffect(() => { setResult(null); setPick(null); setFocus(null); setFocusZone(null); setCandleInfo(null); candleRef.current = null; }, [symbol, timeframe]);

  const fresh = result && result.tfName === timeframe ? result : null;
  // Reproduciendo, lo calculado puede ir unas velas atrás de la última cerrada
  const evalTime = fresh?.times?.length ? fresh.times[fresh.times.length - 1] : null;
  const behind = evalTime !== null && lastTime !== null && lastTime > evalTime ? Math.round((lastTime - evalTime) / tfMs) : 0;
  const focusBlock = focus ? allBlocksOf(doc).find(block => block.uid === focus) : null;
  const zone = doc.zone;
  const openZone = focusZone && zone.picks.some(item => item.uid === focusZone) ? focusZone : null;

  // Lo que se pinta en el gráfico: una fila por capa, las señales, las líneas, la vela elegida y las zonas
  useEffect(() => {
    onBands?.(kitchenBands(fresh, {
      tf: timeframe, pick, focus: focusBlock ? focus : null, focusText: focusBlock ? blockText(focusBlock, side) : '', focusZone: openZone, behind
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh, pick, focus, openZone, timeframe, side, doc, behind]);
  useEffect(() => () => onBands?.([]), []);   // eslint-disable-line react-hooks/exhaustive-deps

  const change = useCallback((next) => { setDoc(next); setNotice(null); }, []);
  const toggleHelp = (id) => setHelp(current => ({ ...current, [id]: !current[id] }));
  const seen = fresh?.seen || 0;
  const candle = candleInfo && candleInfo.t === pick ? candleInfo : null;
  const expressSide = side === 'both' ? viewSide : side;

  // Cada bloque de una serie del gráfico se ofrece solo en las series donde dice algo (un giro, en el flow; un valor
  // grande, en el histograma)
  const fitsSeries = (item) => { const def = blockDef(item.id); return !def?.series || def.series.some(([key]) => key === item.p?.s); };
  const offered = (item) => {
    const def = blockDef(item.id);
    const p = { ...item.p, ...(def?.sided && !isAbsDir(item.p?.dir) ? { dir: relativeDir(item.d || 1, side, viewSide) } : {}) };
    const parts = [];
    if (Number.isFinite(item.obs?.pct)) parts.push(`ahora, ${item.obs.pct > 0 ? '+' : ''}${item.obs.pct} %`);
    if (Number.isFinite(item.obs?.x)) parts.push(`ahora, ${item.obs.x} veces lo típico`);
    if (item.obs?.atr !== undefined) parts.push(`ahora, ${item.obs.atr} ATR`);
    if (item.obs?.meter !== undefined) parts.push(`ahora, ${item.obs.meter > 0 ? '+' : ''}${item.obs.meter}`);
    if (Number.isFinite(item.obs?.share)) parts.push(`ahora, ${item.obs.share} % del volumen${item.id === 'cvd' ? ' de esas velas' : ''}`);
    if (item.late) parts.push(`se supo ${candles(item.late)} después`);
    return { id: item.id, p, note: parts.join(' · ') };
  };

  // La capa de zona: lo que el usuario elige en el gráfico, o uno de sus dibujos
  const usedPick = (candidate) => zone.picks.some(item => samePick(item, candidate));
  const full = zone.picks.length >= MAX_PICKS;
  const addZone = (candidate) => {
    const next = addPick(doc, candidate);
    change(next);
    if (next !== doc) setFocusZone(next.zone.picks[next.zone.picks.length - 1].uid);   // Recién elegida, se resalta en el gráfico
  };
  const zoneNote = (item) => {
    const parts = [item.under ? 'bajo tu clic' : item.touch ? 'esta vela la toca' : Number.isFinite(item.gapAtr) ? `a ${item.gapAtr} ATR de esta vela` : ''];
    if (ZONE_TYPES[item.kind]?.shown) parts.push(`la dibuja «${ZONE_TYPES[item.kind].shown}»`);
    if (item.own) parts.push('cuenta desde ahora');
    return parts.filter(Boolean).join(' · ');
  };
  // Las zonas de la vela elegida. Las que vuelven con `ref` son de la página (un nivel de un VP fijo): se suman como
  // están ahora en el gráfico
  const offerByRef = new Map([...profiles.flatMap(group => group.zones.map(item => [item.id, item])), ...levelOffers.map(item => [item.id, item])]);
  // Una línea del gráfico bajo el clic (el VWAP, una EMA, el Alligator): sus condiciones no dependen de esa vela
  const lineOffers = pickLines.flatMap(line => [
    { id: 'side', p: { ...blockDef('side').p, line, dir: 'favor' } }, { id: 'lejos', p: { ...blockDef('lejos').p, line } },
    { id: 'cross', p: { ...blockDef('cross').p, line, dir: 'favor' } }, { id: 'bounce', p: { ...blockDef('bounce').p, line, dir: 'favor' } }
  ]);
  const candleZones = (candleInfo && candleInfo.t === pick ? candleInfo.zones || [] : [])
    .map(item => (item.ref === undefined ? item : offerByRef.has(item.ref) ? { ...item, own: offerByRef.get(item.ref) } : null))
    .filter(Boolean);
  // Un dibujo cuenta desde ahora (la hora simulada en que se suma), no desde antes: se dibujó sabiendo lo que pasó
  const drawn = drawnZones(getShapes?.() || shapes || [], Number.isFinite(currentTime) ? currentTime : null);
  // Un bloque recién sumado queda abierto: sus opciones (velas, umbrales, sentido) a la vista, y resaltado en el gráfico
  const addOpen = (next) => {
    change(next);
    const before = new Set(allBlocksOf(doc).map(block => block.uid));
    const added = allBlocksOf(next).find(block => !before.has(block.uid));
    if (added) setFocus(added.uid);
  };
  const addZoneEvent = (id) => addOpen(addBlock(doc, pick !== null ? 'auto' : 'step', protoOf(id), pick, tfMs));
  const flowInfo = fresh?.flow || null;
  const isUsed = (item) => allBlocksOf(doc).some(block => block.id === item.id && JSON.stringify(block.p) === JSON.stringify({ ...blockDef(item.id).p, ...item.p }));
  const addFromCandle = (target, item) => {
    const at = pick + (item.lateMs || 0);
    addOpen(addBlock(doc, target, { id: item.id, p: item.p }, at, tfMs));
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
      {missing.length > 0 && (
        <div className="kt-hint">Enciende {missing.map(name => `«${name}»`).join(', ')} en Indicadores: hay bloques que leen lo que ese indicador calcula en el gráfico, con tus ajustes. Mientras esté apagado no cuentan.</div>
      )}
      {lastTime === null && <div className="kt-note">Todavía no cerró ninguna vela en este marco: avanza la simulación.</div>}
      {flowInfo?.state === 'loading' && (
        <div className="kt-hint">
          Order flow: leyendo los trades de este tramo{flowInfo.total > 1 ? ` (${flowInfo.done} de ${flowInfo.total} partes)` : ''}. La primera vez tarda; lo demás ya cuenta, y los bloques de order flow entran solos cuando termine.
        </div>
      )}
      {flowInfo?.state === 'error' && <div className="kt-error">No se pudo leer el order flow de este tramo ({flowInfo.message}). Los bloques de order flow no cuentan; se intenta de nuevo con la próxima vela o el próximo cambio.</div>}
      {flowInfo?.state === 'none' && allBlocksOf(doc).some(block => blockDef(block.id)?.flow) && (
        <div className="kt-note">{symbol} no tiene almacén de trades, o este marco no lo usa: los bloques de order flow de la estrategia no cuentan aquí.</div>
      )}
      {flowInfo?.state === 'ready' && flowInfo.cover < 0.98 && (
        <div className="kt-note">El almacén de trades cubre el {Math.round(flowInfo.cover * 100)} % de estas velas: en el resto, los bloques de order flow no cuentan.</div>
      )}

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
        <span className="kt-chip zone flat">zona</span><span>un área de precio que dura</span>
      </div>

      <div className="kt-phrase">{phrase(doc, price)}</div>

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
          {lineOffers.length > 0 && (
            <>
              <div className="kt-sub">Línea bajo tu clic · {pickLines.map(lineLabel).join(', ')}</div>
              {lineOffers.map((item, i) => (
                <Offer key={`l${i}`} item={item} doc={doc} side={side} at={pick} tfMs={tfMs} onAdd={addFromCandle} used={isUsed(item)} />
              ))}
              <div className="kt-note">Una línea cambia con cada vela: estas condiciones no son de la vela del clic, se cumplen donde se cumplan. Cada una se puede dar vuelta y afinar después, en su bloque.</div>
            </>
          )}
          {candle && (
            <>
              <div className="kt-sub">Zonas en esta vela · {candleZones.length}</div>
              {!candleZones.length && <div className="kt-note">Ninguna cerca: soportes y resistencias, FVG abiertos, order blocks, zonas de liquidaciones o niveles de tus VP fijos a menos de 3 ATR de la vela o de tu clic.</div>}
              {candleZones.map((item, i) => {
                if (item.own) {
                  return (
                    <ZoneOffer key={`z${i}`} zone={item.own} note={zoneNote(item)} used={{ one: usedPick(item.own) }} full={full}
                      onOne={() => addZone(item.own)} oneLabel="Usar esta" />
                  );
                }
                const all = pickFromZone(item, 'kind', side, viewSide);
                const one = pickFromZone(item, 'one', side, viewSide);
                return (
                  <ZoneOffer key={`z${i}`} zone={item} note={zoneNote(item)} used={{ all: usedPick(all), one: usedPick(one) }} full={full}
                    onAll={() => addZone(all)} onOne={() => addZone(one)} />
                );
              })}
              {candleZones.length > 0 && (
                <div className="kt-note">«Todas»: todas las de ese tipo, una regla que después se puede probar. «Solo esta»: esa franja fija, para seguirla en la simulación.{full ? ` La capa admite hasta ${MAX_PICKS} zonas.` : ''}</div>
              )}
              <div className="kt-sub">Eventos de esta vela · {candle.events.length}</div>
              {candle.flow === 'loading' && <div className="kt-note">Los de order flow todavía se están leyendo: aparecen solos al terminar.</div>}
              {!candle.events.length && <div className="kt-note">Ninguno de los que la cocina conoce.</div>}
              {candle.events.filter(fitsSeries).map((item, i) => {
                const offer = { ...offered(item), lateMs: (item.late || 0) * tfMs };
                return <Offer key={`e${i}`} item={offer} doc={doc} side={side} at={pick + offer.lateMs} tfMs={tfMs} onAdd={addFromCandle} used={isUsed(offer)} />;
              })}
              <div className="kt-sub">Estados que se cumplen aquí · {candle.states.length}</div>
              {candle.states.filter(fitsSeries).map((item, i) => {
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
        {!zone.picks.length && <div className="kt-empty">Aquí van las zonas: haz clic en una del gráfico, o en la vela donde el precio la toca</div>}
        {zone.picks.map((item, index) => (
          <React.Fragment key={item.uid}>
            {index > 0 && <div className="kt-count">o</div>}
            <ZoneChip pick={item} side={side} info={fresh?.zone?.picks?.[item.uid]} lastTime={lastTime} tfMs={tfMs} open={openZone === item.uid}
              onOpen={() => setFocusZone(current => (current === item.uid ? null : item.uid))}
              onRemove={() => { change(removePick(doc, item.uid)); if (focusZone === item.uid) setFocusZone(null); }} />
          </React.Fragment>
        ))}
        {zone.picks.length > 0 && (
          <>
            <div className="kt-row small">
              <span className="kt-label">El precio</span>
              <select value={zone.rel} onChange={e => change(setZone(doc, { rel: e.target.value }))}>
                <option value="near">se acerca a</option>
                <option value="in">la toca</option>
              </select>
              {zone.rel === 'near' && (
                <>
                  <input type="number" min={ZONE_NEAR.min} max={ZONE_NEAR.max} step={0.1} value={zone.atr}
                    onChange={e => { const value = Number(e.target.value); if (e.target.value !== '' && value >= ZONE_NEAR.min) change(setZone(doc, { atr: value })); }} />
                  <span>ATR o menos</span>
                </>
              )}
            </div>
            <div className="kt-row small">
              <span className="kt-label">Se mira</span>
              <select value={zone.when} onChange={e => change(setZone(doc, { when: e.target.value }))}>
                <option value="first">mientras se junta el paso 1</option>
                <option value="last">en la señal</option>
              </select>
              {fresh?.zone?.has && (
                <span className="kt-count">se cumple en {number(fresh.zone.count)} de {candles(seen)} · el precio llegó {times(fresh.zone.arrivals)}</span>
              )}
            </div>
            <div className="kt-row small">
              <span className="kt-label">Pedir en un paso que el precio</span>
              <button type="button" className="btn-quick" onClick={() => addZoneEvent('ztoca')} title={blockDef('ztoca').help}>+ llegue a la zona</button>
              <button type="button" className="btn-quick" onClick={() => addZoneEvent('zrech')} title={blockDef('zrech').help}>+ la rechace</button>
            </div>
          </>
        )}
        <div className="kt-sub">Tus dibujos · {drawn.length}</div>
        {!drawn.length && <div className="kt-note">Un rectángulo o una línea horizontal que dibujes en el gráfico aparece aquí, para usarlo como zona.</div>}
        {drawn.map(item => (
          <ZoneOffer key={item.id} zone={item} used={{ one: usedPick(item) }} full={full} onOne={() => addZone(item)} oneLabel="Usar esta" />
        ))}
        {drawn.length > 0 && <div className="kt-note">Un dibujo cuenta desde el momento en que lo sumas, no hacia atrás: lo trazaste viendo lo que ya pasó. Si después lo mueves, la zona de la estrategia no cambia: quítala y súmalo otra vez.</div>}
        <div className="kt-sub">Tus VP fijos · {profiles.length}</div>
        {!profiles.length && <div className="kt-note">Un perfil de volumen de rango fijo (VP Fixed Range) que tengas en el gráfico aparece aquí: su POC, su VAH, su VAL y su área de valor (del VAL al VAH) sirven de zona.</div>}
        {profiles.map(group => (
          <div key={group.id} className="kt-vp">
            <span className="kt-count">
              {group.label ? `Rango ${group.label} · ` : ''}{when(group.start)} a {Number.isFinite(currentTime) && group.end > currentTime ? 'ahora (su rango sigue abierto)' : when(group.end)}
              {group.real ? ' · volumen real' : ''}
            </span>
            <div className="kt-row">
              {group.zones.map(item => {
                const used = usedPick(item);
                const what = item.shape === 'va' ? 'el área de valor' : `el ${VP_PARTS[item.shape]}`;
                return (
                  <button key={item.id} type="button" className="btn-quick" disabled={used || full} onClick={() => addZone(item)}
                    title={used ? 'Ya está en la estrategia' : `Usar ${what} de este perfil como zona fija: ${pickRange(item, price)}`}>
                    {used ? '✓ ' : ''}{VP_PARTS[item.shape]}{item.shape === 'va' ? '' : ` ${price(item.lo)}`}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {profiles.length > 0 && <div className="kt-note">Un nivel de un VP fijo cuenta desde el momento en que lo sumas, con el precio que tiene ahora, no hacia atrás: el rango lo elegiste viendo lo que ya pasó. Si el perfil cambia después (su rango sigue abierto, o lo mueves), la zona de la estrategia no cambia: quítala y súmala otra vez.</div>}
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
                    Se cumple {times(info.done)}{usedSteps.indexOf(index) > 0 || doc.ctx.length || zone.picks.length ? `; encadenado con lo anterior, ${times(info.reached)}` : ''}
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
            : <>Todavía no hay gatillo: el contexto y la zona solos no dan señales.</>}
          {usedSteps.length > 0 && !fresh.signals.length && <div className="kt-count">Mira en qué paso se corta: es el que tiene pocas o ninguna vez «encadenado».</div>}
          {fresh.pending && allBlocksOf(doc).some(block => blockDef(block.id)?.flow) && (
            <div className="kt-count">Falta el order flow: esta cuenta todavía no incluye sus bloques.</div>
          )}
          <div className="kt-count">Se lee así: {phrase(doc, price)}</div>
          <div className="kt-count">
            Solo cuenta velas ya cerradas en la hora simulada.
            {behind > 0 ? ` Calculado hasta la vela del ${when(evalTime)}: ${behind === 1 ? 'falta 1 vela' : `faltan ${number(behind)} velas`}, que entran en un momento.` : busy ? ' Actualizando…' : ' Al día.'}
          </div>
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
                        <button type="button" className={`btn-quick${def.kind === STATE ? ' kt-main' : ''}`} onClick={() => addOpen(addBlock(doc, 'ctx', protoOf(def.id), null, tfMs))}>Contexto</button>
                        <button type="button" className={`btn-quick${def.kind === EVENT ? ' kt-main' : ''}`} onClick={() => addOpen(addBlock(doc, 'step', protoOf(def.id), null, tfMs))}>Paso {doc.gat.length}</button>
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
