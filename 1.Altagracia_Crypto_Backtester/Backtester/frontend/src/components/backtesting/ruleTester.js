/**
 * Probador de reglas del Observador: lo que no depende de React. La regla que arma la ventana, su forma para
 * el backend (backend/rule_tester.py), las reglas guardadas y los textos del informe.
 */

export const TESTER_PARAM = 'probador';
export const RULE_TIMEFRAMES = [5, 15, 30, 60, 240];
export const CHART_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h'];
export const TF_LABEL = { 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h' };
export const MAX_ELEMENTS = 6;
export const MAX_FILTERS = 3;

export const isRuleTester = (location = window.location) => new URLSearchParams(location.search).get(TESTER_PARAM) === '1';

export const ruleTesterUrl = (symbol, location = window.location) => (
  `${location.origin}${location.pathname}?${TESTER_PARAM}=1${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ''}`
);

export function testerSymbol(location = window.location) {
  const symbol = (new URLSearchParams(location.search).get('symbol') || 'BTCUSDT').toUpperCase();
  return /^[A-Z0-9]{3,20}$/.test(symbol) ? symbol : 'BTCUSDT';
}

/** Regla con la que abre la ventana: el ejemplo del pedido (VA abandonada, stop en el swing anterior, 2R) */
export function defaultRule() {
  return {
    name: 'VA abandonada', tf: 15, codes: ['VA'], mode: 'all', min: 1, window: 1, side: 'both', invert: false,
    swing: false, swingBars: 5, momentum: false, confirm: false, confirmAtr: 0.25, confirmBars: 2,
    entryType: 'market', entryAt: 'near', entryExpiry: 8,
    stopType: 'swing', stopBars: 5, stopAtr: 1.5, stopBuffer: 0.1, stopMaxAtr: 6,
    useTarget: true, targetR: 2, trail: false, trailBars: 5, useHorizon: true, horizon: 200, opposite: false,
    oneAtATime: true, cooldown: 8, vaGap: 0, filters: [], volFilter: 2, target: 0.05,
    // En secuencia: `first` son los elementos de contexto (el barrido) y el resto, el gatillo que llega después
    first: [], liqWhat: 'zone', liqVariant: 'pierce', liqSwingBars: 5, liqReclaimBars: 3
  };
}

const number = (value, fallback) => (Number.isFinite(Number(value)) && value !== '' && value !== null ? Number(value) : fallback);

export const MAX_WINDOW = 10;

/** En secuencia, qué elementos son el contexto y cuáles el gatillo. Sin uno de los dos no hay secuencia */
export function sequenceParts(rule, codes = rule.codes || []) {
  if (rule.mode !== 'sequence') return { first: [], trigger: codes };
  const first = codes.filter(code => (rule.first || []).includes(code));
  const trigger = codes.filter(code => !first.includes(code));
  return first.length && trigger.length ? { first, trigger } : { first: [], trigger: codes };
}

/** La regla de la ventana en la forma que espera el backend. Cada elemento elegido es una casilla */
export function toBackendRule(rule) {
  const codes = [...new Set(rule.codes || [])].slice(0, MAX_ELEMENTS);
  const all = rule.mode !== 'atLeast';
  const { first, trigger } = sequenceParts(rule, codes);
  const sequence = first.length > 0;
  return {
    name: (rule.name || 'Regla').trim().slice(0, 60),
    tf: RULE_TIMEFRAMES.includes(Number(rule.tf)) ? Number(rule.tf) : 15,
    ...(codes.includes('LIQ') ? {
      liq: { what: rule.liqWhat === 'swing' ? 'swing' : 'zone', variant: rule.liqVariant === 'reclaim' ? 'reclaim' : 'pierce', swingBars: number(rule.liqSwingBars, 5), reclaimBars: number(rule.liqReclaimBars, 3) }
    } : {}),
    recipe: {
      // En secuencia: todo el contexto primero y, en la misma vela o después, al menos `min` del gatillo
      slots: sequence
        ? [...first.map(code => ({ codes: [code], group: 0 })), ...trigger.map(code => ({ codes: [code], group: 1 }))]
        : codes.map(code => ({ codes: [code], group: 0 })),
      mode: sequence ? 'sequence' : (all ? 'strict' : 'threshold'),
      ...(sequence ? { sameBar: true, groupMins: { 0: first.length, 1: Math.max(1, Math.min(trigger.length, number(rule.min, 1))) } } : {}),
      min: all || sequence ? codes.length : Math.max(1, Math.min(codes.length, number(rule.min, 1))),
      window: Math.max(1, Math.min(MAX_WINDOW, number(rule.window, 1))),
      side: ['both', 'long', 'short'].includes(rule.side) ? rule.side : 'both',
      swing: { on: !!rule.swing, bars: number(rule.swingBars, 5), flex: 1 },
      momentum: !!rule.momentum,
      entry: { on: !!rule.confirm, atr: number(rule.confirmAtr, 0.25), bars: number(rule.confirmBars, 2) }
    },
    invert: !!rule.invert,
    entry: { type: rule.entryType === 'limit' ? 'limit' : 'market', at: rule.entryAt || 'near', expiry: number(rule.entryExpiry, 8) },
    stop: {
      type: rule.stopType || 'swing', bars: number(rule.stopBars, 5), atr: number(rule.stopAtr, 1.5),
      buffer: number(rule.stopBuffer, 0.1), maxAtr: number(rule.stopMaxAtr, 6)
    },
    exit: {
      targetR: rule.useTarget ? number(rule.targetR, 2) : null,
      trail: rule.trail ? 'swing' : 'none', trailBars: number(rule.trailBars, 5),
      horizon: rule.useHorizon ? number(rule.horizon, 200) : null,
      opposite: !!rule.opposite
    },
    oneAtATime: rule.oneAtATime !== false,
    cooldown: rule.oneAtATime !== false ? Math.max(0, Math.round(number(rule.cooldown, 0))) : 0,
    vaGap: (rule.codes || []).includes('VA') ? Math.max(0, number(rule.vaGap, 0)) : 0,
    filters: (rule.filters || []).filter(f => f.key && f.value !== '' && Number.isFinite(Number(f.value))).slice(0, MAX_FILTERS)
      .map(f => ({ key: f.key, op: f.op === '<=' ? '<=' : '>=', value: Number(f.value) })),
    volFilter: number(rule.volFilter, 2), target: number(rule.target, 0.05)
  };
}

/** Una regla que devolvió el backend (historial de corridas), de vuelta a la forma de la ventana */
export function fromBackendRule(saved) {
  const base = defaultRule();
  if (!saved?.recipe) return base;
  const recipe = saved.recipe;
  const sequence = recipe.mode === 'sequence';
  return {
    ...base,
    name: saved.name || base.name, tf: saved.tf || 15,
    codes: (recipe.slots || []).map(slot => slot.codes?.[0]).filter(Boolean),
    mode: sequence ? 'sequence' : (recipe.mode === 'threshold' ? 'atLeast' : 'all'),
    min: sequence ? (recipe.groupMins?.[1] ?? 1) : (recipe.min || 1), window: recipe.window || 1,
    first: sequence ? (recipe.slots || []).filter(slot => !slot.group).map(slot => slot.codes?.[0]).filter(Boolean) : [],
    liqWhat: saved.liq?.what || 'swing', liqVariant: saved.liq?.variant || 'pierce', liqSwingBars: saved.liq?.swingBars ?? 5, liqReclaimBars: saved.liq?.reclaimBars ?? 3,
    side: recipe.side || 'both', invert: !!saved.invert,
    swing: !!recipe.swing?.on, swingBars: recipe.swing?.bars ?? 5, momentum: !!recipe.momentum,
    confirm: !!recipe.entry?.on, confirmAtr: recipe.entry?.atr ?? 0.25, confirmBars: recipe.entry?.bars ?? 2,
    entryType: saved.entry?.type || 'market', entryAt: saved.entry?.at || 'near', entryExpiry: saved.entry?.expiry ?? 8,
    stopType: saved.stop?.type || 'swing', stopBars: saved.stop?.bars ?? 5, stopAtr: saved.stop?.atr ?? 1.5,
    stopBuffer: saved.stop?.buffer ?? 0.1, stopMaxAtr: saved.stop?.maxAtr ?? 6,
    useTarget: saved.exit?.targetR != null, targetR: saved.exit?.targetR ?? 2,
    trail: saved.exit?.trail === 'swing', trailBars: saved.exit?.trailBars ?? 5,
    useHorizon: saved.exit?.horizon != null, horizon: saved.exit?.horizon ?? 200, opposite: !!saved.exit?.opposite,
    oneAtATime: saved.oneAtATime !== false, cooldown: saved.cooldown ?? 0, vaGap: saved.vaGap ?? 0, filters: saved.filters || [],
    volFilter: saved.volFilter ?? 2, target: saved.target ?? 0.05
  };
}

/** La regla en una línea, para el historial y el encabezado del informe */
export function describeRule(saved) {
  if (!saved?.recipe) return '';
  const recipe = saved.recipe;
  const codes = (recipe.slots || []).map(slot => (slot.codes || []).join('|'));
  const part = (group) => (recipe.slots || []).filter(slot => (slot.group || 0) === group).map(slot => (slot.codes || []).join('|'));
  const liq = saved.liq ? ` (${saved.liq.what === 'zone' ? 'zona' : `swing ${saved.liq.swingBars}`}, ${saved.liq.variant === 'reclaim' ? 'recupera' : 'perfora'})` : '';
  const joined = (recipe.mode === 'sequence' ? `${part(0).join(' + ')} → ${part(1).join(recipe.groupMins?.[1] > 1 ? ' + ' : ' o ')}`
    : recipe.mode === 'threshold' && recipe.min < codes.length ? `${recipe.min} de ${codes.join(', ')}` : codes.join(' + ')) + liq;
  const stop = { swing: `swing ${saved.stop?.bars}`, candle: 'vela del elemento', zone: 'borde de la zona', atr: `${saved.stop?.atr} ATR` }[saved.stop?.type] || '';
  const exits = [];
  if (saved.exit?.targetR != null) exits.push(`${saved.exit.targetR}R`);
  if (saved.exit?.trail === 'swing') exits.push('stop arrastrado');
  if (saved.exit?.horizon != null) exits.push(`${saved.exit.horizon} velas`);
  if (saved.exit?.opposite) exits.push('señal contraria');
  return `${TF_LABEL[saved.tf] || saved.tf} · ${joined}${recipe.window > 1 ? ` @${recipe.window}` : ''}${saved.invert ? ' · invertida' : ''}`
    + `${saved.vaGap > 0 ? ` · hueco ≥ ${saved.vaGap} ATR` : ''}`
    + ` · ${saved.entry?.type === 'limit' ? 'limit' : 'mercado'} · stop ${stop} · ${exits.join(', ') || 'sin objetivo'}`
    + `${saved.cooldown > 0 ? ` · espera ${saved.cooldown} velas` : ''}`;
}

const RULES_KEY = 'tester_rules_v1';

export function loadSavedRules(storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage.getItem(RULES_KEY));
    return Array.isArray(list) ? list.filter(item => item?.name && Array.isArray(item.codes)) : [];
  } catch {
    return [];
  }
}

/** Guarda la regla con su nombre: una con el mismo nombre se reemplaza */
export function saveRule(rule, storage = globalThis.localStorage) {
  const name = (rule.name || 'Regla').trim();
  const list = [{ ...rule, name }, ...loadSavedRules(storage).filter(item => item.name !== name)].slice(0, 60);
  try {
    storage.setItem(RULES_KEY, JSON.stringify(list));
  } catch {
    // Sin almacenamiento la regla dura hasta cerrar la ventana
  }
  return list;
}

export function deleteRule(name, storage = globalThis.localStorage) {
  const list = loadSavedRules(storage).filter(item => item.name !== name);
  try {
    storage.setItem(RULES_KEY, JSON.stringify(list));
  } catch {
    // Igual que al guardar
  }
  return list;
}

/** Cajas que dibuja MiniChart (getTradeBoxes) con los trades de una corrida */
export function tradeBoxes(trades = [], tfMinutes = 15) {
  return trades.map(trade => ({
    side: trade.dir > 0 ? 'long' : 'short', entry: trade.entry, stop: trade.stop,
    target: trade.target ?? trade.exit, start: trade.entry_t,
    end: Math.max(trade.exit_t, trade.entry_t + tfMinutes * 60000)
  }));
}

export const fmtR = (value, digits = 2) => (value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${Number(value).toFixed(digits)}`);
export const fmtPct = (value) => (value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`);

/** Orden de la tabla de trades */
export function sortTrades(trades, key, descending) {
  const value = (trade) => (key === 'votes' ? trade.votes.join(' ') : trade[key]);
  const sorted = [...trades].sort((a, b) => {
    const x = value(a), y = value(b);
    if (x === y) return a.n - b.n;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return x < y ? -1 : 1;
  });
  return descending ? sorted.reverse() : sorted;
}
