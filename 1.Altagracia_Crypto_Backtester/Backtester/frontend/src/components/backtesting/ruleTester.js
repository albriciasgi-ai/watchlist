/**
 * Probador de reglas del Observador: lo que no depende de React. La regla que arma la ventana, su forma para
 * el backend (backend/rule_tester.py), las reglas guardadas y los textos del informe.
 */

export const TESTER_PARAM = 'probador';
export const RULE_TIMEFRAMES = [5, 15, 30, 60, 240, 1440];
export const DAILY_TF = 1440; // En 1 día la regla corre sobre velas: solo valen los elementos que no necesitan el almacén de trades
export const CHART_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h'];
export const TF_LABEL = { 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', 1440: '1D' };
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
    first: [], liqWhat: 'zone', liqVariant: 'pierce', liqSwingBars: 5, liqReclaimBars: 3,
    // Perfil por sesión (VR, VF, VX): periodo, minutos sostenido dentro o fuera del valor y velas para que un fallo cierre de vuelta
    vpHours: 24, vpAccept: 30, vpFailBars: 3, vpShapes: [], vpVeEntry: 'touch', targetAt: 'r',
    // Cambio de carácter: marco de la estructura (0 = el de la regla), desde qué hora UTC se cuentan sus velas, velas del swing y tramos
    ccTf: 0, ccOffset: 0, ccSwing: 3, ccLegs: 2,
    // Horario: solo señales que se conocen entre esas horas UTC
    useHours: false, hoursFrom: '17:30', hoursTo: '21:30', hoursWeekdays: true,
    bxMaxHeightOn: false, bxMaxHeight: 5.5, beShare: 0.2, beMaxBody: 1, beRejection: 0.6,
    regimeMode: 'any', regimeMajor: true, regimeMajorOut: 6, regimeAfter: 6, regimeDaily: false,
    // Patrones de vela: tendencia previa, volumen mínimo (z-score) y mecha del martillo en cuerpos
    patTrend: true, patTrendBars: 5, patVolume: false, patMinZ: 1, patWick: 2,
    // Filtros de línea: off, side (cierra del lado a favor) o touch (además la mecha la toca)
    vwapMode: 'off', vwapPeriod: 200, vwapSlope: false, vwapMaxDevOn: false, vwapMaxDev: 1, emaMode: 'off', emaPeriod: 14, emaSlope: false,
    // Volumen de Respuesta: ATR con que gira el tramo, veces el volumen de su hora, flecha a favor o en contra del tramo, y rombo como giro o para seguir
    rvLeg: 2, rvSpike: 2, rvArrow: 'with', rvRombo: 'turn',
    // Gaussian Channel: periodo y polos del filtro, ancho de las bandas, canal a favor y cómo sale por el canal
    gcPeriod: 144, gcPoles: 4, gcMult: 1.414, gcTrend: true, gcExit: 'band'
  };
}

const number = (value, fallback) => (Number.isFinite(Number(value)) && value !== '' && value !== null ? Number(value) : fallback);

export const MAX_WINDOW = 10;
export const VP_CODES = ['VR', 'VF', 'VX', 'VE'];
// Forma del perfil de la sesión anterior: dónde quedó el volumen dentro de su rango
export const VP_SHAPES = [['D', 'D · volumen en el medio'], ['P', 'P · volumen arriba, cola abajo'], ['b', 'b · volumen abajo, cola arriba'], ['B', 'B · dos distribuciones']];
export const VP_PERIODS = [[4, '4 horas'], [8, '8 horas'], [12, '12 horas'], [24, '1 día'], [168, '1 semana']];
export const PATTERN_CODES = ['HM', 'EN', 'DJ'];
export const RV_CODES = ['RF', 'RB'];
export const usesResponse = (rule) => (rule.codes || []).some(code => RV_CODES.includes(code));
export const usesPatterns = (rule) => (rule.codes || []).some(code => PATTERN_CODES.includes(code));
export const CC_STRUCT_TFS = [[0, 'el marco de la regla'], [60, '1 hora'], [240, '4 horas'], [1440, '1 día']];
export const CC_OFFSETS = [[0, '00:00 UTC'], [810, '13:30 UTC (apertura de Nueva York, verano)'], [870, '14:30 UTC (apertura de Nueva York, invierno)']];
/** 'HH:MM' a minutos del día; null si no es una hora */
export const minuteOfDay = (text) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};
const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export const usesProfile = (rule) => (rule.codes || []).some(code => VP_CODES.includes(code));

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
    ...(usesPatterns(rule) ? {
      pat: { trend: rule.patTrend !== false, trendBars: number(rule.patTrendBars, 5), minZ: rule.patVolume ? number(rule.patMinZ, 1) : null, wick: number(rule.patWick, 2) }
    } : {}),
    ...(codes.includes('GC') ? {
      gc: { period: number(rule.gcPeriod, 144), poles: number(rule.gcPoles, 4), mult: number(rule.gcMult, 1.414), trend: rule.gcTrend !== false, exit: ['band', 'mid', 'none'].includes(rule.gcExit) ? rule.gcExit : 'band' }
    } : {}),
    ...(usesResponse(rule) ? {
      rv: { leg: number(rule.rvLeg, 2), spike: number(rule.rvSpike, 2), arrow: ['with', 'against', 'any'].includes(rule.rvArrow) ? rule.rvArrow : 'with', rombo: rule.rvRombo === 'follow' ? 'follow' : 'turn' }
    } : {}),
    ...(rule.vwapMode !== 'off' || rule.emaMode !== 'off' ? {
      lines: [
        ...(['side', 'touch'].includes(rule.vwapMode) ? [{ type: 'vwap', period: number(rule.vwapPeriod, 200), mode: rule.vwapMode, slope: !!rule.vwapSlope, ...(rule.vwapMaxDevOn ? { maxDev: number(rule.vwapMaxDev, 1) } : {}) }] : []),
        ...(['side', 'touch'].includes(rule.emaMode) ? [{ type: 'ema', period: number(rule.emaPeriod, 14), mode: rule.emaMode, slope: !!rule.emaSlope }] : [])
      ]
    } : {}),
    ...(codes.includes('CC') ? { cc: { tf: number(rule.ccTf, 0) || undefined, offset: number(rule.ccOffset, 0), swing: number(rule.ccSwing, 3), legs: number(rule.ccLegs, 2) } } : {}),
    ...(rule.useHours && minuteOfDay(rule.hoursFrom) !== null && minuteOfDay(rule.hoursTo) !== null
      ? { hours: { on: true, from: minuteOfDay(rule.hoursFrom), to: minuteOfDay(rule.hoursTo), weekdays: !!rule.hoursWeekdays } } : {}),
    ...(codes.includes('BX') ? { bx: { maxHeight: rule.bxMaxHeightOn ? number(rule.bxMaxHeight, 5.5) : null } } : {}),
    ...(codes.includes('BE') ? { be: { share: number(rule.beShare, 0.2), maxBody: number(rule.beMaxBody, 1), rejection: number(rule.beRejection, 0.6) } } : {}),
    ...(['inside', 'outside', 'breakout'].includes(rule.regimeMode)
      ? { regime: { mode: rule.regimeMode, major: !!rule.regimeMajor, majorOut: number(rule.regimeMajorOut, 6), after: number(rule.regimeAfter, 6),
        ...(rule.regimeDaily && number(rule.tf, 15) < DAILY_TF ? { tf: DAILY_TF } : {}) } } : {}),
    ...(usesProfile(rule) ? { vp: { hours: number(rule.vpHours, 24), accept: number(rule.vpAccept, 30), failBars: number(rule.vpFailBars, 3), shapes: rule.vpShapes || [], veEntry: rule.vpVeEntry === 'resting' ? 'resting' : 'touch' } } : {}),
    recipe: {
      // En secuencia: todo el contexto primero y, en la misma vela o después, al menos `min` del gatillo
      slots: sequence
        ? [...first.map(code => ({ codes: [code], group: 0 })), ...trigger.map(code => ({ codes: [code], group: 1 }))]
        : codes.map(code => ({ codes: [code], group: 0 })),
      mode: sequence ? 'sequence' : (all ? 'strict' : 'threshold'),
      ...(sequence ? { sameBar: true, groupMins: { 0: first.length, 1: Math.max(1, Math.min(trigger.length, number(rule.min, 1))) } } : {}),
      min: all || sequence ? codes.length : Math.max(1, Math.min(codes.length, number(rule.min, 1))),
      // Con un solo elemento la ventana no se ve en pantalla: vale 1, aunque quede una mayor de una regla anterior
      window: codes.length > 1 ? Math.max(1, Math.min(MAX_WINDOW, number(rule.window, 1))) : 1,
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
      // Objetivo en un nivel del perfil de la sesión anterior, en vez de un múltiplo del riesgo
      ...(rule.useTarget && usesProfile(rule) && ['poc', 'edge', 'mid'].includes(rule.targetAt) ? { targetAt: rule.targetAt } : {}),
      // Un borde de caja puede apuntar al centro de su caja
      ...(rule.useTarget && !usesProfile(rule) && (rule.codes || []).includes('BE') && rule.targetAt === 'mid' ? { targetAt: 'mid' } : {}),
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
    useTarget: saved.exit?.targetR != null || !!saved.targetAt, targetR: saved.exit?.targetR ?? 2, targetAt: saved.targetAt || 'r',
    ccTf: saved.cc && saved.cc.tf !== saved.tf ? saved.cc.tf : 0, ccOffset: saved.cc?.offset ?? 0, ccSwing: saved.cc?.swing ?? 3, ccLegs: saved.cc?.legs ?? 2,
    patTrend: saved.pat ? saved.pat.trend !== false : true, patTrendBars: saved.pat?.trendBars ?? 5,
    rvLeg: saved.rv?.leg ?? 2, rvSpike: saved.rv?.spike ?? 2, rvArrow: saved.rv?.arrow || 'with', rvRombo: saved.rv?.rombo || 'turn',
    gcPeriod: saved.gc?.period ?? 144, gcPoles: saved.gc?.poles ?? 4, gcMult: saved.gc?.mult ?? 1.414, gcTrend: saved.gc ? saved.gc.trend !== false : true, gcExit: saved.gc?.exit || 'band',
    patVolume: saved.pat?.minZ != null, patMinZ: saved.pat?.minZ ?? 1, patWick: saved.pat?.wick ?? 2,
    vwapMode: (saved.lines || []).find(l => l.type === 'vwap')?.mode || 'off', vwapPeriod: (saved.lines || []).find(l => l.type === 'vwap')?.period ?? 200,
    vwapSlope: !!(saved.lines || []).find(l => l.type === 'vwap')?.slope,
    vwapMaxDevOn: (saved.lines || []).find(l => l.type === 'vwap')?.maxDev != null, vwapMaxDev: (saved.lines || []).find(l => l.type === 'vwap')?.maxDev ?? 1,
    emaMode: (saved.lines || []).find(l => l.type === 'ema')?.mode || 'off', emaPeriod: (saved.lines || []).find(l => l.type === 'ema')?.period ?? 14,
    emaSlope: !!(saved.lines || []).find(l => l.type === 'ema')?.slope,
    useHours: !!saved.hours, hoursFrom: saved.hours ? clock(saved.hours.from) : '17:30', hoursTo: saved.hours ? clock(saved.hours.to) : '21:30',
    hoursWeekdays: saved.hours ? !!saved.hours.weekdays : true,
    bxMaxHeightOn: saved.bx?.maxHeight != null, bxMaxHeight: saved.bx?.maxHeight ?? 5.5,
    beShare: saved.be?.share ?? 0.2, beMaxBody: saved.be?.maxBody ?? 1, beRejection: saved.be?.rejection ?? 0.6,
    regimeMode: saved.regime?.mode || 'any', regimeMajor: saved.regime ? saved.regime.major !== false : true,
    regimeMajorOut: saved.regime?.majorOut ?? 6, regimeAfter: saved.regime?.after ?? 6, regimeDaily: saved.regime?.tf === DAILY_TF,
    vpShapes: saved.vp?.shapes || [], vpVeEntry: saved.vp?.veEntry || 'touch', vpHours: saved.vp?.hours ?? 24, vpAccept: saved.vp?.accept ?? 30, vpFailBars: saved.vp?.failBars ?? 3,
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
  if (saved.targetAt) exits.push(saved.be && !saved.vp ? 'centro de la caja' : { poc: 'POC anterior', edge: 'borde contrario del valor', mid: 'centro del rango anterior' }[saved.targetAt]);
  else if (saved.exit?.targetR != null) exits.push(`${saved.exit.targetR}R`);
  if (saved.exit?.trail === 'swing') exits.push('stop arrastrado');
  if (saved.exit?.horizon != null) exits.push(`${saved.exit.horizon} velas`);
  if (saved.exit?.opposite) exits.push('señal contraria');
  if (saved.gc && saved.gc.exit !== 'none') exits.push(saved.gc.exit === 'mid' ? 'cierre al otro lado de la línea central' : 'cierre de vuelta dentro de la banda');
  return `${TF_LABEL[saved.tf] || saved.tf} · ${joined}${recipe.window > 1 ? ` @${recipe.window}` : ''}${saved.invert ? ' · invertida' : ''}`
    + `${saved.vaGap > 0 ? ` · hueco ≥ ${saved.vaGap} ATR` : ''}`
    + `${saved.regime ? ` · ${{ inside: 'solo en rango', outside: 'solo fuera de rango', breakout: `${saved.regime.after} velas tras romper` }[saved.regime.mode]}${saved.regime.major ? ' mayor' : ''}` : ''}`
    + `${saved.cc ? ` · estructura ${saved.cc.tf >= 60 ? `${saved.cc.tf / 60} h` : `${saved.cc.tf} m`}, swing ${saved.cc.swing}` : ''}`
    + `${saved.pat ? ` · patrón${saved.pat.trend ? ' tras tendencia' : ''}${saved.pat.minZ != null ? `, z ≥ ${saved.pat.minZ}` : ''}` : ''}`
    + `${saved.rv ? ` · tramo ${saved.rv.leg} ATR${codes.includes('RF') ? `, flecha ≥ ${saved.rv.spike}x ${{ with: 'a favor del tramo', against: 'contra el tramo', any: 'de cualquier lado' }[saved.rv.arrow]}` : ''}${codes.includes('RB') ? `, rombo ${saved.rv.rombo === 'follow' ? 'siguiendo el tramo' : 'como giro'}` : ''}` : ''}`
    + `${saved.gc ? ` · canal ${saved.gc.period}, ${saved.gc.poles} polos, ×${saved.gc.mult}${saved.gc.trend ? ', a favor' : ''}` : ''}`
    + (saved.lines || []).map(l => ` · ${l.mode === 'touch' ? 'toca' : 'a favor de'} ${l.type === 'vwap' ? 'VWAP' : 'EMA'} ${l.period}${l.slope ? ' con pendiente' : ''}${l.maxDev ? `, abre a ${l.maxDev} desv. o menos` : ''}`).join('')
    + `${saved.hours ? ` · ${clock(saved.hours.from)}–${clock(saved.hours.to)} UTC` : ''}`
    + `${saved.vp ? ` · perfil de ${saved.vp.hours} h${saved.vp.shapes?.length ? ` (${saved.vp.shapes.join(', ')})` : ''}` : ''}`
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

const usdShort = (usd) => (usd >= 1e6 ? `${(usd / 1e6).toFixed(1)}M` : `${Math.round(usd / 1e3)}K`);

/**
 * Lo que la regla vio en un trade, para dibujarlo al elegirlo (MiniChart, getTradeBands): las zonas de liquidaciones
 * que había en el barrido (la barrida, resaltada), el nivel pasado y dónde estaba cada elemento de la regla.
 * Las corridas anteriores al 18/11/2026 no guardaron esto: devuelve [].
 */
export function tradeBands(trade, tfMinutes = 15, names = {}) {
  if (!trade) return [];
  const tf = tfMinutes * 60000;
  const end = Math.max(trade.exit_t, trade.entry_t + tf);
  const bands = [];
  const liq = trade.liq;
  if (liq?.zones && Number.isFinite(liq.t)) {
    const start = Math.min(liq.swingT ?? liq.t, liq.t) - 30 * tf;
    for (const [low, high, usd, side, swept] of liq.zones) {
      bands.push({
        kind: side === 'long' ? 'liqLong' : 'liqShort', low, high, start, end, strong: !!swept,
        label: `${swept ? 'Barrida · ' : ''}${usdShort(usd)} ${side === 'long' ? 'largos' : 'cortos'} liquidados`
      });
    }
    bands.push({ kind: 'level', price: liq.swing, start: liq.swingT ?? start, end, label: liq.what === 'zone' ? 'Borde pasado' : 'Swing barrido' });
    bands.push({ kind: 'mark', time: liq.t, price: liq.extreme, label: 'Barrido' });
  }
  if (trade.box && Number.isFinite(trade.box.low)) {
    // La caja de la ruptura o del borde: punteada antes de que se supiera, continua desde que se supo
    const box = trade.box;
    if (box.start < box.detected) bands.push({ kind: 'outline', low: box.low, high: box.high, start: box.start, end: box.detected, strong: false });
    bands.push({ kind: 'outline', low: box.low, high: box.high, start: box.detected, end: Math.min(end, Math.max(trade.signal + tf, box.detected)), strong: true });
    bands.push({ kind: 'level', price: (box.low + box.high) / 2, start: box.detected, end, label: 'Centro de la caja' });
  }
  const vp = trade.vp;
  if (vp && Number.isFinite(vp.session)) {
    // El valor de la sesión anterior, dibujado sobre la sesión del trade, donde la regla lo usó
    const start = vp.session;
    const stop = Math.max(end, Math.min(vp.session + vp.hours * 3600000, end + 20 * tf));
    bands.push({ kind: 'value', low: vp.val, high: vp.vah, start, end: stop, strong: false, label: `Valor de la sesión anterior (${vp.hours} h${vp.shape ? `, perfil ${vp.shape}` : ''})` });
    bands.push({ kind: 'level', price: vp.poc, start, end: stop, label: 'POC anterior' });
    if (Number.isFinite(vp.high) && Number.isFinite(vp.low)) {
      bands.push({ kind: 'level', price: vp.high, start, end: stop, label: 'Máximo anterior' });
      bands.push({ kind: 'level', price: vp.low, start, end: stop, label: 'Mínimo anterior' });
    }
    if (Number.isFinite(vp.extreme)) bands.push({ kind: 'mark', time: trade.signal, price: vp.extreme, label: 'Extremo' });
  }
  for (const line of trade.lines || []) {
    // Dónde estaba la línea en la vela de la señal
    bands.push({ kind: 'level', price: line.value, start: trade.signal - 20 * tf, end: trade.signal + 2 * tf, label: `${line.type === 'vwap' ? 'VWAP' : 'EMA'} ${line.period}` });
    if (Number.isFinite(line.limit)) bands.push({ kind: 'level', price: line.limit, start: trade.signal - 20 * tf, end: trade.signal + 2 * tf, label: `VWAP ${line.maxDev} desv.` });
  }
  if (trade.gc) {
    // El canal en la vela de la señal: la banda que se cruzó y la línea central
    bands.push({ kind: 'level', price: trade.dir > 0 ? trade.gc.high : trade.gc.low, start: trade.signal - 20 * tf, end: trade.signal + 2 * tf, label: trade.dir > 0 ? 'Banda superior' : 'Banda inferior' });
    bands.push({ kind: 'level', price: trade.gc.mid, start: trade.signal - 20 * tf, end: trade.signal + 2 * tf, label: 'Línea central' });
  }
  const cc = trade.cc;
  if (cc && Number.isFinite(cc.level)) {
    // El swing que se rompió, desde su vela, y el extremo de la tendencia
    bands.push({ kind: 'level', price: cc.level, start: cc.levelT, end, label: 'Swing roto' });
    bands.push({ kind: 'level', price: cc.extreme, start: cc.levelT, end, label: 'Extremo de la tendencia' });
    bands.push({ kind: 'mark', time: trade.signal, price: cc.level, label: 'Ruptura' });
  }
  for (const mark of trade.marks || []) {
    if (mark.code === 'LIQ' || mark.code === 'CC' || mark.code === 'GC' || VP_CODES.includes(mark.code)) continue;
    bands.push({ kind: 'element', low: mark.lo, high: mark.hi, start: mark.t, end, strong: false, label: `${mark.code} ${names[mark.code] || ''}`.trim() });
  }
  return bands;
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

const DAY_MS = 86400000;
const YEAR_DAYS = 365; // Cripto opera todos los días

/**
 * Los trades como una sola cuenta: cada uno arriesga `riskPct` % del capital que hay al entrar, y su resultado
 * (R por lo arriesgado) entra a la cuenta al salir. Varias posiciones pueden estar abiertas a la vez.
 * Los retornos son diarios (UTC) y solo con trades cerrados: lo que pasa dentro de un trade abierto no se ve.
 * trades: objetos con entry_t, exit_t y r, o ternas [entry_t, exit_t, r]. Devuelve null sin trades o sin riesgo.
 */
export function accountStats(trades = [], riskPct = 1) {
  const risk = Math.max(0, Number(riskPct) || 0) / 100;
  const list = (trades || []).map(t => (Array.isArray(t) ? { entry_t: t[0], exit_t: t[1], r: t[2] } : t))
    .filter(t => t && Number.isFinite(t.r) && Number.isFinite(t.entry_t) && Number.isFinite(t.exit_t));
  if (!list.length || !risk) return null;
  const events = [];
  list.forEach((t, i) => {
    events.push([t.entry_t, 1, i]);
    events.push([Math.max(t.exit_t, t.entry_t + 1), 0, i]);
  });
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // A la misma hora, primero las salidas
  let equity = 1, open = 0, maxOpen = 0, peak = 1, maxDrawdown = 0;
  const size = new Array(list.length);
  const closes = new Map(); // día → capital al final de ese día
  const curve = [];
  for (const [time, kind, i] of events) {
    if (kind === 1) {
      size[i] = risk * equity;
      open += 1;
      maxOpen = Math.max(maxOpen, open);
    } else {
      equity = Math.max(0, equity + list[i].r * size[i]);
      open -= 1;
      peak = Math.max(peak, equity);
      if (peak > 0) maxDrawdown = Math.max(maxDrawdown, 1 - equity / peak);
      closes.set(Math.floor(time / DAY_MS), equity);
      curve.push([time, Math.round((equity - 1) * 10000) / 100]);
    }
  }
  const first = Math.floor(events[0][0] / DAY_MS), last = Math.floor(events[events.length - 1][0] / DAY_MS);
  const returns = [];
  const months = new Map(); // mes → [capital al empezar, capital al terminar]
  let previous = 1;
  for (let day = first; day <= last; day++) {
    const now = closes.has(day) ? closes.get(day) : previous;
    returns.push(previous > 0 ? now / previous - 1 : 0);
    const date = new Date(day * DAY_MS);
    const key = date.getUTCFullYear() * 12 + date.getUTCMonth();
    if (!months.has(key)) months.set(key, [previous, now]);
    else months.get(key)[1] = now;
    previous = now;
  }
  const n = returns.length;
  const mean = returns.reduce((sum, r) => sum + r, 0) / n;
  const deviation = n > 1 ? Math.sqrt(returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (n - 1)) : 0;
  const downside = Math.sqrt(returns.reduce((sum, r) => sum + Math.min(r, 0) ** 2, 0) / n);
  const years = n / YEAR_DAYS;
  const round = (value, digits = 2) => (Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null);
  const monthly = [...months.values()].map(([start, end]) => (start > 0 ? end / start - 1 : 0));
  return {
    trades: list.length, days: n, years: round(years, 2), riskPct: risk * 100,
    totalReturn: round((equity - 1) * 100, 1),
    // Con menos de 3 meses, anualizar exagera
    annualReturn: years >= 0.25 && equity > 0 ? round((equity ** (1 / years) - 1) * 100, 1) : null,
    sharpe: deviation > 0 ? round((mean / deviation) * Math.sqrt(YEAR_DAYS)) : null,
    sortino: downside > 0 ? round((mean / downside) * Math.sqrt(YEAR_DAYS)) : null,
    maxDrawdown: round(maxDrawdown * 100, 1),
    worstDay: round(Math.min(...returns) * 100, 2), bestDay: round(Math.max(...returns) * 100, 2),
    maxOpen, maxOpenRisk: round(maxOpen * risk * 100, 2),
    months: monthly.length, positiveMonths: monthly.filter(r => r > 0).length,
    worstMonth: round(Math.min(...monthly) * 100, 1),
    equity: curve
  };
}
