/**
 * Probador de reglas del Observador: lo que no depende de React. La regla que arma la ventana, su forma para
 * el backend (backend/rule_tester.py), las reglas guardadas y los textos del informe.
 */
import { elementLabel, elementLabels } from './elementLabels.js';
import { defaultWilliamsConfig } from '../indicators/williams.js';
import { defaultSmcConfig } from '../indicators/smcStructure.js';

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
    entryType: 'market', entryAt: 'near', entryExpiry: 8, straddleFrom: 'zone', straddleOffset: 0.2,
    stopType: 'swing', stopBars: 5, stopAtr: 1.5, stopBuffer: 0.1, stopMaxAtr: 6,
    useTarget: true, targetR: 2, trail: false, trailBars: 5,
    // Trailing desde el mejor precio (atr o pct; trail sigue siendo el de swings), con arranque y stop a la entrada
    trailMode: 'off', trailAtr: 4, trailPct: 5, trailStartOn: false, trailStart: 1, breakEvenOn: false, breakEven: 1.5,
    // Trailing del objetivo, como un bot: al llegar a tpTrailStart R (antes del objetivo) el objetivo sigue al mejor precio
    // a tpTrailDist (en R, ATR o %) y el trade se cierra cuando el precio vuelve hasta él
    tpTrailOn: false, tpTrailStart: 2.5, tpTrailDist: 0.5, tpTrailUnit: 'r',
    // Objetivo distinto cuando los flujos on-chain van a favor del trade (21/11): esos días el mercado da más
    chainTargetOn: false, chainTargetR: 5, chainTargetMetric: 'stable', chainTargetAsset: 'auto', chainTargetDays: 30, chainTargetZ: 0.5,
    cpMaxHeightOn: false, cpMaxHeight: 5.5, imBars: 3, imAtr: 2, imRangeOn: false, imRange: 1.5, useHorizon: true, horizon: 200, opposite: false,
    oneAtATime: true, cooldown: 8, vaGap: 0, filters: [], volFilter: 2, target: 0.05,
    // En secuencia: `first` son los elementos de contexto (el barrido) y el resto, el gatillo que llega después
    first: [], liqWhat: 'zone', liqVariant: 'pierce', liqSwingBars: 5, liqReclaimBars: 3,
    // Perfil por sesión (VR, VF, VX): periodo, minutos sostenido dentro o fuera del valor y velas para que un fallo cierre de vuelta
    vpHours: 24, vpAccept: 30, vpFailBars: 3, vpShapes: [], vpVeEntry: 'touch', targetAt: 'r',
    // Cambio de carácter: marco de la estructura (0 = el de la regla), desde qué hora UTC se cuentan sus velas, velas del swing y tramos
    ccTf: 0, ccOffset: 0, ccSwing: 3, ccLegs: 2,
    // Horario: solo señales que se conocen entre esas horas UTC
    useHours: false, hoursFrom: '17:30', hoursTo: '21:30', hoursWeekdays: true,
    bxMaxHeightOn: false, bxMaxHeight: 5.5, beShare: 0.2, beMaxBody: 1, beRejection: 0.6, bePattern: false,
    // FVG nuevo (hueco mínimo en ATR) y swing del detector (velas por lado y volumen mínimo)
    fvMinAtr: 0.3, spBars: 5, spVolume: false, spMinZ: 1,
    // Elementos de Byko (21/11): las cifras fijadas en docs/PLAN_ESTRATEGIAS_BYKO_DALE.md antes de correrlos
    fbBack: 3, fbApproachBars: 4, fbApproachAtr: 2, fbVol: 3, baBars: 6, baNear: 1,
    taRise: 2, taRiseBars: 10, taShare: 0.2, taOiBars: 3, taZ: 2, taAdvance: 0.5, taSource: 'sum',
    poMove: 3, poBars: 6, poVol: 3, poOiBars: 2, poZ: 2, poSource: 'sum',
    // Zonas de Dale con el primer regreso (21/11): velas completas para armarse, stop en % del ATR diario, y lo propio de DA y DC
    daleAway: 2, daleMinDay: 0.1, daleMaxDay: 0.2, daleBuffer: 0.1, daleRun: 3, daleLeg: 3, daleMinLeg: 5, daleBump: 1.5,
    // Filtros de flujo: CVD de N velas a favor y OI (rise, fall, conf, noconf u off)
    cvdOn: false, cvdBars: 20, oiMode: 'off', oiBars: 6, oiPct: 2,
    // Multitud por el funding (off, nocon, contra) y OI sostenido (parte de los pasos de 4 h con el OI al alza)
    crowdMode: 'off', steadyOn: false, steadyDays: 14, steadyMin: 0.52,
    // Flujos on-chain diarios de Coin Metrics (21/11): off, net (flujo neto de BTC o ETH a los exchanges) o stable (emisión de stablecoins)
    chainMetric: 'off', chainAsset: 'auto', chainDays: 7, chainZ: 0.5, chainMode: 'favor',
    regimeMode: 'any', regimeMajor: true, regimeMajorOut: 6, regimeAfter: 6, regimeDaily: false,
    // Patrones de vela: tendencia previa, volumen mínimo (z-score) y mecha del martillo en cuerpos
    patTrend: true, patTrendBars: 5, patVolume: false, patMinZ: 1, patWick: 2,
    // Filtros de línea: off, side (cierra del lado a favor) o touch (además la mecha la toca)
    vwapMode: 'off', vwapPeriod: 200, vwapSlope: false, vwapMaxDevOn: false, vwapMaxDev: 1, emaMode: 'off', emaPeriod: 14, emaSlope: false,
    // emaTf (22/11): la EMA leída en un marco mayor (0 = el de la regla), con su cierre, en su última vela cerrada
    emaTf: 0,
    // Volumen de Respuesta: ATR con que gira el tramo, veces el volumen de su hora, flecha a favor o en contra del tramo, y rombo como giro o para seguir
    rvLeg: 2, rvSpike: 2, rvArrow: 'with', rvRombo: 'turn',
    // Gaussian Channel: periodo y polos del filtro, ancho de las bandas, canal a favor y cómo sale por el canal
    gcPeriod: 144, gcPoles: 4, gcMult: 1.414, gcTrend: true, gcExit: 'band',
    // Tres sabios de Williams: mínimo más bajo que N velas, angulación en N velas, hueco mínimo con la mandíbula, AO en contra y
    // el 3.º solo del lado correcto de los dientes. Entrada con una orden stop: offset en ATR y si se cancela al pasar el otro borde
    wiseLookback: 1, wiseAngBars: 5, wiseMinGapAtr: 0, wiseRequireAo: true, wiseTeeth: true, entryStopOffset: 0, entryStopCancel: true,
    // Estructura SMC: de qué estructura (interna o mayor) y sus velas, qué ruptura, cómo es el order block, iguales y su barrido
    smcScope: 'swing', smcSwing: 50, smcInternal: 5, smcBreak: 'any', smcPick: 'extreme', smcArea: 'full', smcMitigation: 'close',
    smcEqLength: 3, smcEqThreshold: 0.1, smcReclaim: true,
    // Filtros de Williams (Alligator: off, awake, side, sleeping; zona a favor) y SMC (premium/discount y tendencia mayor).
    // Desde el 21/11, AO y AC (off, color, zero, both), Gator (off, eating, open, sleeping) y MFI (off, green, squat, volume, notFake)
    bwAlligator: 'off', bwZone: false, smcPd: false, smcBias: false, bwAo: 'off', bwAc: 'off', bwGator: 'off', bwMfi: 'off',
    // Lector VPA (21/11): grado desde el que cuenta un elemento, umbral y memoria del medidor, rango que se rompe y retroceso;
    // filtro del medidor (off, favor, notAgainst) con su umbral
    vpaFire: 0.5, vpaMeter: 1, vpaDecay: 0.75, vpaLeg: 2, vpaRangeBars: 20, vpaMaxRangeAtr: 6, vpaPullBars: 8, vpaMode: 'off', vpaThr: 1, vpaTf: 0,
    // Salida VPA (fase 4): sale con la primera lectura en contra; vpaExitFrom = R a favor desde los que se arma (0 = desde la entrada)
    vpaExitOn: false, vpaExit: ['climax'], vpaExitThr: 1, vpaExitFrom: 0
  };
}

/** Los filtros de Williams en palabras (los mismos de rule_tester.BW_*_TEXT en el backend) */
export const BW_ALLIGATOR_TEXT = { awake: 'Alligator despierto a favor', side: 'cierre del lado de los dientes del Alligator', sleeping: 'Alligator dormido' };
export const BW_MOMENTUM_TEXT = { color: 'con la barra a favor', zero: 'del lado del cero a favor', both: 'con la barra a favor y del lado del cero' };
export const BW_GATOR_TEXT = { eating: 'comiendo (sus dos barras crecen)', open: 'despierto (al menos una barra crece)', sleeping: 'dormido (sus dos barras se achican)' };
export const BW_MFI_TEXT = {
  green: 'vela verde (suben el MFI y el volumen)', squat: 'vela squat (baja el MFI y sube el volumen)',
  volume: 'vela verde o squat (sube el volumen)', notFake: 'la vela no es fake'
};

/** Los filtros de Williams del formulario en la forma del backend, o null si no hay ninguno */
export function williamsFilter(rule) {
  const bwf = {
    ...(BW_ALLIGATOR_TEXT[rule.bwAlligator] ? { alligator: rule.bwAlligator } : {}),
    ...(rule.bwZone ? { zone: true } : {}),
    ...(BW_MOMENTUM_TEXT[rule.bwAo] ? { ao: rule.bwAo } : {}),
    ...(BW_MOMENTUM_TEXT[rule.bwAc] ? { ac: rule.bwAc } : {}),
    ...(BW_GATOR_TEXT[rule.bwGator] ? { gator: rule.bwGator } : {}),
    ...(BW_MFI_TEXT[rule.bwMfi] ? { mfi: rule.bwMfi } : {})
  };
  return Object.keys(bwf).length ? bwf : null;
}

const number = (value, fallback) => (Number.isFinite(Number(value)) && value !== '' && value !== null ? Number(value) : fallback);

export const MAX_WINDOW = 10;
export const VP_CODES = ['VR', 'VF', 'VX', 'VE'];
// Forma del perfil de la sesión anterior: dónde quedó el volumen dentro de su rango
export const VP_SHAPES = [['D', 'D · volumen en el medio'], ['P', 'P · volumen arriba, cola abajo'], ['b', 'b · volumen abajo, cola arriba'], ['B', 'B · dos distribuciones']];
export const VP_PERIODS = [[4, '4 horas'], [8, '8 horas'], [12, '12 horas'], [24, '1 día'], [168, '1 semana']];
export const PATTERN_CODES = ['HM', 'EN', 'DJ'];
export const WISE_CODES = ['WD', 'WA', 'WF'];
export const SMC_CODES = ['BS', 'OB', 'BK', 'EQ'];
export const DALE_CODES = ['DS', 'DN', 'DG', 'DA', 'DC', 'DX'];  // Zonas de Trader Dale con el primer regreso (21/11); DX, hipótesis del 22/11
export const VPA_CODES = ['QA', 'QB', 'QF', 'QR', 'QT', 'QS', 'QC', 'QE'];
export const usesVpa = (rule) => (rule.codes || []).some(code => VPA_CODES.includes(code));
/** El filtro del medidor VPA en palabras (el mismo de rule_tester en el backend) */
export const VPA_FILTER_TEXT = { favor: 'medidor VPA a favor', notAgainst: 'medidor VPA que no esté en contra', notFavor: 'medidor VPA que no esté fuerte a favor' };
/** Marcos mayores en que el filtro puede leer el medidor (el "ripple" de Coulling): solo los mayores que el de la regla */
export const VPA_FILTER_TFS = [[60, '1 hora'], [240, '4 horas'], [1440, '1 día']];
export const vpaFilterTf = (tf, vpaTf) => {
  const hi = Number(vpaTf) || 0;
  return hi > Number(tf) && hi % Number(tf) === 0 && VPA_FILTER_TFS.some(([m]) => m === hi) ? hi : 0;
};
export const vpaFrameText = (hi) => (hi ? ` de ${VPA_FILTER_TFS.find(([m]) => m === hi)?.[1]}` : '');
/** Las lecturas de la salida VPA, en el orden del backend (rule_tester.VPA_EXITS) */
export const VPA_EXITS = [
  ['climax', 'clímax o frenado', 'Clímax o volumen de frenado (QC, QS) en contra del trade: el movimiento se agota'],
  ['absorb', 'esfuerzo en contra', 'Esfuerzo sin resultado en contra: una vela de tu color con mucho volumen y poco rango (alguien absorbe tu lado)'],
  ['push', 'retroceso con volumen', 'Una vela del color contrario validada (rango ancho con volumen alto): el retroceso ya no viene con poco volumen'],
  ['meter', 'medidor en contra', 'El medidor del lector en contra del trade, al umbral o más allá'],
  ['fade', 'esfuerzo que se agota', 'El tramo de tu lado sigue avanzando con cada vez menos volumen']
];
/** La salida VPA del formulario para el backend, o null si está apagada */
export const vpaExitRule = (rule) => {
  const on = VPA_EXITS.map(([key]) => key).filter(key => (rule.vpaExit || []).includes(key));
  if (!rule.vpaExitOn || !on.length) return null;
  return { on, fromR: Math.max(0, Number(rule.vpaExitFrom) || 0), ...(on.includes('meter') ? { thr: Number(rule.vpaExitThr) || 1 } : {}) };
};
/** La salida VPA de una regla del backend en palabras */
export const vpaExitText = (vx) => `${vx.on.map(key => (VPA_EXITS.find(([k]) => k === key) || [key, key])[1]).join(', ')}${vx.on.includes('meter') && vx.thr != null ? ` (medidor ±${vx.thr})` : ''}${vx.fromR ? `, desde ${vx.fromR}R` : ''}`;
export const usesWise = (rule) => (rule.codes || []).some(code => WISE_CODES.includes(code));
export const usesSmc = (rule) => (rule.codes || []).some(code => SMC_CODES.includes(code));
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
/** El objetivo va en R (no en un nivel del perfil ni en el centro de la caja): solo así se puede arrastrar */
export const targetInR = (rule) => !!rule.useTarget && rule.targetAt !== 'weak'
  && !((usesProfile(rule) && rule.targetAt !== 'r') || (!usesProfile(rule) && (rule.codes || []).includes('BE') && rule.targetAt === 'mid'));
export const TP_TRAIL_UNITS = [['r', 'R'], ['atr', 'ATR'], ['pct', '%']];

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
        ...(['side', 'touch'].includes(rule.emaMode) ? [{ type: 'ema', period: number(rule.emaPeriod, 14), mode: rule.emaMode, slope: !!rule.emaSlope,
          ...(vpaFilterTf(rule.tf, rule.emaTf) ? { tf: vpaFilterTf(rule.tf, rule.emaTf) } : {}) }] : [])
      ]
    } : {}),
    ...(codes.includes('CC') ? { cc: { tf: number(rule.ccTf, 0) || undefined, offset: number(rule.ccOffset, 0), swing: number(rule.ccSwing, 3), legs: number(rule.ccLegs, 2) } } : {}),
    ...(rule.useHours && minuteOfDay(rule.hoursFrom) !== null && minuteOfDay(rule.hoursTo) !== null
      ? { hours: { on: true, from: minuteOfDay(rule.hoursFrom), to: minuteOfDay(rule.hoursTo), weekdays: !!rule.hoursWeekdays } } : {}),
    ...(codes.includes('BX') ? { bx: { maxHeight: rule.bxMaxHeightOn ? number(rule.bxMaxHeight, 5.5) : null } } : {}),
    ...(codes.includes('BE') ? { be: { share: number(rule.beShare, 0.2), maxBody: number(rule.beMaxBody, 1), rejection: number(rule.beRejection, 0.6), ...(rule.bePattern ? { pattern: true } : {}) } } : {}),
    ...(codes.includes('CP') ? { cp: { maxHeight: rule.cpMaxHeightOn ? number(rule.cpMaxHeight, 5.5) : null } } : {}),
    ...(codes.includes('IM') ? { im: { bars: number(rule.imBars, 3), atr: number(rule.imAtr, 2), range: rule.imRangeOn ? number(rule.imRange, 1.5) : null } } : {}),
    ...(codes.includes('FV') ? { fv: { minAtr: number(rule.fvMinAtr, 0.3) } } : {}),
    ...(codes.includes('SP') ? { sp: { bars: number(rule.spBars, 5), minZ: rule.spVolume ? number(rule.spMinZ, 1) : null } } : {}),
    ...(codes.includes('FB') ? { fb: { back: number(rule.fbBack, 3), approachBars: number(rule.fbApproachBars, 4), approachAtr: number(rule.fbApproachAtr, 2), vol: number(rule.fbVol, 3) } } : {}),
    ...(codes.includes('BA') ? { ba: { bars: number(rule.baBars, 6), near: number(rule.baNear, 1) } } : {}),
    ...(codes.includes('TA') ? { ta: { rise: number(rule.taRise, 2), riseBars: number(rule.taRiseBars, 10), share: number(rule.taShare, 0.2), oiBars: number(rule.taOiBars, 3),
      z: number(rule.taZ, 2), advance: number(rule.taAdvance, 0.5), source: rule.taSource || 'sum' } } : {}),
    ...(codes.includes('PO') ? { po: { move: number(rule.poMove, 3), bars: number(rule.poBars, 6), vol: number(rule.poVol, 3), oiBars: number(rule.poOiBars, 2),
      z: number(rule.poZ, 2), source: rule.poSource || 'sum' } } : {}),
    ...(codes.some(code => DALE_CODES.includes(code)) ? { dale: { away: number(rule.daleAway, 2), minDay: number(rule.daleMinDay, 0.1), maxDay: number(rule.daleMaxDay, 0.2),
      buffer: number(rule.daleBuffer, 0.1), run: number(rule.daleRun, 3), leg: number(rule.daleLeg, 3), minLeg: number(rule.daleMinLeg, 5), bump: number(rule.daleBump, 1.5) } } : {}),
    ...(rule.cvdOn || ['rise', 'fall', 'conf', 'noconf'].includes(rule.oiMode) || ['nocon', 'contra'].includes(rule.crowdMode) || rule.steadyOn
      || CHAIN_METRICS.includes(rule.chainMetric)
      ? { flow: { ...(rule.cvdOn ? { cvd: number(rule.cvdBars, 20) } : {}),
        ...(['rise', 'fall', 'conf', 'noconf'].includes(rule.oiMode) ? { oi: rule.oiMode, oiBars: number(rule.oiBars, 6), oiPct: number(rule.oiPct, 2) } : {}),
        ...(['nocon', 'contra'].includes(rule.crowdMode) ? { crowd: rule.crowdMode } : {}),
        ...(rule.steadyOn ? { steady: true, steadyDays: number(rule.steadyDays, 14), steadyMin: number(rule.steadyMin, 0.52) } : {}),
        ...(CHAIN_METRICS.includes(rule.chainMetric) ? { chain: { metric: rule.chainMetric, days: number(rule.chainDays, 7), z: number(rule.chainZ, 0.5),
          mode: rule.chainMode === 'nocontra' ? 'nocontra' : 'favor', ...(rule.chainMetric === 'net' ? { asset: ['btc', 'eth'].includes(rule.chainAsset) ? rule.chainAsset : 'auto' } : {}) } } : {}) } } : {}),
    ...(['inside', 'outside', 'breakout'].includes(rule.regimeMode)
      ? { regime: { mode: rule.regimeMode, major: !!rule.regimeMajor, majorOut: number(rule.regimeMajorOut, 6), after: number(rule.regimeAfter, 6),
        ...(rule.regimeDaily && number(rule.tf, 15) < DAILY_TF ? { tf: DAILY_TF } : {}) } } : {}),
    ...(usesWise(rule) ? {
      wise: { lookback: number(rule.wiseLookback, 1), angBars: number(rule.wiseAngBars, 5), minGapAtr: number(rule.wiseMinGapAtr, 0),
        requireAo: rule.wiseRequireAo !== false, teeth: rule.wiseTeeth !== false }
    } : {}),
    ...(usesSmc(rule) ? {
      smc: { scope: rule.smcScope === 'internal' ? 'internal' : 'swing', swing: number(rule.smcSwing, 50), internal: number(rule.smcInternal, 5),
        break: ['any', 'bos', 'choch'].includes(rule.smcBreak) ? rule.smcBreak : 'any', pick: rule.smcPick === 'opposite' ? 'opposite' : 'extreme',
        area: rule.smcArea === 'body' ? 'body' : 'full', mitigation: rule.smcMitigation === 'wick' ? 'wick' : 'close',
        eqLength: number(rule.smcEqLength, 3), eqThreshold: number(rule.smcEqThreshold, 0.1), reclaim: rule.smcReclaim !== false }
    } : {}),
    ...(williamsFilter(rule) ? { bwf: williamsFilter(rule) } : {}),
    ...(usesVpa(rule) || VPA_FILTER_TEXT[rule.vpaMode] || vpaExitRule(rule) ? {
      vpa: { fire: number(rule.vpaFire, 0.5), meter: number(rule.vpaMeter, 1), decay: number(rule.vpaDecay, 0.75), legAtr: number(rule.vpaLeg, 2),
        rangeBars: number(rule.vpaRangeBars, 20), maxRangeAtr: number(rule.vpaMaxRangeAtr, 6), pullBars: number(rule.vpaPullBars, 8) }
    } : {}),
    ...(VPA_FILTER_TEXT[rule.vpaMode] ? { vpaf: { mode: rule.vpaMode, thr: number(rule.vpaThr, 1), ...(vpaFilterTf(rule.tf, rule.vpaTf) ? { tf: vpaFilterTf(rule.tf, rule.vpaTf) } : {}) } } : {}),
    ...(rule.smcPd || rule.smcBias ? { smcf: { ...(rule.smcPd ? { pd: true } : {}), ...(rule.smcBias ? { bias: true } : {}), swing: number(rule.smcSwing, 50) } } : {}),
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
    entry: rule.entryType === 'straddle'
      ? { type: 'straddle', from: rule.straddleFrom === 'close' ? 'close' : 'zone', offset: number(rule.straddleOffset, 0.2), expiry: number(rule.entryExpiry, 8) }
      : rule.entryType === 'stop'
        ? { type: 'stop', offset: number(rule.entryStopOffset, 0), expiry: number(rule.entryExpiry, 5), cancel: rule.entryStopCancel !== false }
        : { type: rule.entryType === 'limit' ? 'limit' : 'market', at: rule.entryAt || 'near', expiry: number(rule.entryExpiry, 8) },
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
      // El máximo (largo) o el mínimo (corto) del rango mayor SMC: el lado débil
      ...(rule.useTarget && rule.targetAt === 'weak' ? { targetAt: 'weak' } : {}),
      trail: rule.trail ? 'swing' : (['atr', 'pct', 'bars'].includes(rule.trailMode) ? rule.trailMode : 'none'), trailBars: number(rule.trailBars, 5),
      ...(!rule.trail && rule.trailMode === 'atr' ? { trailAtr: number(rule.trailAtr, 4) } : {}),
      ...(!rule.trail && rule.trailMode === 'pct' ? { trailPct: number(rule.trailPct, 5) } : {}),
      ...(!rule.trail && ['atr', 'pct'].includes(rule.trailMode) && rule.trailStartOn ? { trailStart: number(rule.trailStart, 1) } : {}),
      ...(rule.breakEvenOn ? { breakEven: number(rule.breakEven, 1.5) } : {}),
      ...(rule.tpTrailOn && targetInR(rule) ? {
        tpTrail: {
          start: Math.min(number(rule.tpTrailStart, 2.5), number(rule.targetR, 2)), dist: number(rule.tpTrailDist, 0.5),
          unit: ['r', 'atr', 'pct'].includes(rule.tpTrailUnit) ? rule.tpTrailUnit : 'r'
        }
      } : {}),
      ...(rule.chainTargetOn && targetInR(rule) && !rule.tpTrailOn && CHAIN_METRICS.includes(rule.chainTargetMetric) ? {
        chainTarget: { r: number(rule.chainTargetR, 5), metric: rule.chainTargetMetric, days: number(rule.chainTargetDays, 30), z: number(rule.chainTargetZ, 0.5),
          mode: 'favor', ...(rule.chainTargetMetric === 'net' ? { asset: ['btc', 'eth'].includes(rule.chainTargetAsset) ? rule.chainTargetAsset : 'auto' } : {}) }
      } : {}),
      horizon: rule.useHorizon ? number(rule.horizon, 200) : null,
      opposite: !!rule.opposite,
      ...(vpaExitRule(rule) ? { vpa: vpaExitRule(rule) } : {})
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
    entryStopOffset: saved.entry?.type === 'stop' ? (saved.entry.offset ?? 0) : 0, entryStopCancel: saved.entry?.type === 'stop' ? saved.entry.cancel !== false : true,
    wiseLookback: saved.wise?.lookback ?? 1, wiseAngBars: saved.wise?.angBars ?? 5, wiseMinGapAtr: saved.wise?.minGapAtr ?? 0,
    wiseRequireAo: saved.wise ? saved.wise.requireAo !== false : true, wiseTeeth: saved.wise ? saved.wise.teeth !== false : true,
    smcScope: saved.smc?.scope || 'swing', smcSwing: saved.smc?.swing ?? saved.smcf?.swing ?? 50, smcInternal: saved.smc?.internal ?? 5,
    smcBreak: saved.smc?.break || 'any', smcPick: saved.smc?.pick || 'extreme', smcArea: saved.smc?.area || 'full',
    smcMitigation: saved.smc?.mitigation || 'close', smcEqLength: saved.smc?.eqLength ?? 3, smcEqThreshold: saved.smc?.eqThreshold ?? 0.1,
    smcReclaim: saved.smc ? saved.smc.reclaim !== false : true,
    bwAlligator: saved.bwf?.alligator || 'off', bwZone: !!saved.bwf?.zone, smcPd: !!saved.smcf?.pd, smcBias: !!saved.smcf?.bias,
    bwAo: saved.bwf?.ao || 'off', bwAc: saved.bwf?.ac || 'off', bwGator: saved.bwf?.gator || 'off', bwMfi: saved.bwf?.mfi || 'off',
    vpaFire: saved.vpa?.fire ?? 0.5, vpaMeter: saved.vpa?.meter ?? 1, vpaDecay: saved.vpa?.decay ?? 0.75, vpaLeg: saved.vpa?.legAtr ?? 2,
    vpaRangeBars: saved.vpa?.rangeBars ?? 20, vpaMaxRangeAtr: saved.vpa?.maxRangeAtr ?? 6, vpaPullBars: saved.vpa?.pullBars ?? 8,
    vpaMode: saved.vpaf?.mode || 'off', vpaThr: saved.vpaf?.thr ?? 1, vpaTf: saved.vpaf?.tf || 0,
    vpaExitOn: !!saved.exit?.vpa, vpaExit: saved.exit?.vpa?.on || ['climax'], vpaExitThr: saved.exit?.vpa?.thr ?? 1, vpaExitFrom: saved.exit?.vpa?.fromR ?? 0,
    straddleFrom: saved.entry?.from || 'zone', straddleOffset: saved.entry?.offset ?? 0.2,
    trailMode: ['atr', 'pct', 'bars'].includes(saved.exit?.trail) ? saved.exit.trail : 'off', trailAtr: saved.exit?.trailAtr ?? 4, trailPct: saved.exit?.trailPct ?? 5,
    trailStartOn: saved.exit?.trailStart != null, trailStart: saved.exit?.trailStart ?? 1, breakEvenOn: saved.exit?.breakEven != null, breakEven: saved.exit?.breakEven ?? 1.5,
    tpTrailOn: !!saved.exit?.tpTrail, tpTrailStart: saved.exit?.tpTrail?.start ?? 2.5, tpTrailDist: saved.exit?.tpTrail?.dist ?? 0.5,
    tpTrailUnit: saved.exit?.tpTrail?.unit || 'r',
    chainTargetOn: !!saved.exit?.chainTarget, chainTargetR: saved.exit?.chainTarget?.r ?? 5, chainTargetMetric: saved.exit?.chainTarget?.metric || 'stable',
    chainTargetAsset: saved.exit?.chainTarget?.asset || 'auto', chainTargetDays: saved.exit?.chainTarget?.days ?? 30, chainTargetZ: saved.exit?.chainTarget?.z ?? 0.5,
    cpMaxHeightOn: saved.cp?.maxHeight != null, cpMaxHeight: saved.cp?.maxHeight ?? 5.5,
    imBars: saved.im?.bars ?? 3, imAtr: saved.im?.atr ?? 2, imRangeOn: saved.im?.range != null, imRange: saved.im?.range ?? 1.5,
    stopType: saved.stop?.type || 'swing', stopBars: saved.stop?.bars ?? 5, stopAtr: saved.stop?.atr ?? 1.5,
    stopBuffer: saved.stop?.buffer ?? 0.1, stopMaxAtr: saved.stop?.maxAtr ?? 6,
    // El objetivo en un nivel va arriba en la regla limpia del backend y en exit en la que arma la ventana: vale de las dos
    useTarget: saved.exit?.targetR != null || !!(saved.targetAt ?? saved.exit?.targetAt), targetR: saved.exit?.targetR ?? 2,
    targetAt: saved.targetAt ?? saved.exit?.targetAt ?? 'r',
    ccTf: saved.cc && saved.cc.tf !== saved.tf ? saved.cc.tf : 0, ccOffset: saved.cc?.offset ?? 0, ccSwing: saved.cc?.swing ?? 3, ccLegs: saved.cc?.legs ?? 2,
    patTrend: saved.pat ? saved.pat.trend !== false : true, patTrendBars: saved.pat?.trendBars ?? 5,
    rvLeg: saved.rv?.leg ?? 2, rvSpike: saved.rv?.spike ?? 2, rvArrow: saved.rv?.arrow || 'with', rvRombo: saved.rv?.rombo || 'turn',
    gcPeriod: saved.gc?.period ?? 144, gcPoles: saved.gc?.poles ?? 4, gcMult: saved.gc?.mult ?? 1.414, gcTrend: saved.gc ? saved.gc.trend !== false : true, gcExit: saved.gc?.exit || 'band',
    patVolume: saved.pat?.minZ != null, patMinZ: saved.pat?.minZ ?? 1, patWick: saved.pat?.wick ?? 2,
    vwapMode: (saved.lines || []).find(l => l.type === 'vwap')?.mode || 'off', vwapPeriod: (saved.lines || []).find(l => l.type === 'vwap')?.period ?? 200,
    vwapSlope: !!(saved.lines || []).find(l => l.type === 'vwap')?.slope,
    vwapMaxDevOn: (saved.lines || []).find(l => l.type === 'vwap')?.maxDev != null, vwapMaxDev: (saved.lines || []).find(l => l.type === 'vwap')?.maxDev ?? 1,
    emaMode: (saved.lines || []).find(l => l.type === 'ema')?.mode || 'off', emaPeriod: (saved.lines || []).find(l => l.type === 'ema')?.period ?? 14,
    emaSlope: !!(saved.lines || []).find(l => l.type === 'ema')?.slope, emaTf: (saved.lines || []).find(l => l.type === 'ema')?.tf || 0,
    useHours: !!saved.hours, hoursFrom: saved.hours ? clock(saved.hours.from) : '17:30', hoursTo: saved.hours ? clock(saved.hours.to) : '21:30',
    hoursWeekdays: saved.hours ? !!saved.hours.weekdays : true,
    bxMaxHeightOn: saved.bx?.maxHeight != null, bxMaxHeight: saved.bx?.maxHeight ?? 5.5,
    beShare: saved.be?.share ?? 0.2, beMaxBody: saved.be?.maxBody ?? 1, beRejection: saved.be?.rejection ?? 0.6, bePattern: !!saved.be?.pattern,
    fvMinAtr: saved.fv?.minAtr ?? 0.3, spBars: saved.sp?.bars ?? 5, spVolume: saved.sp?.minZ != null, spMinZ: saved.sp?.minZ ?? 1,
    fbBack: saved.fb?.back ?? 3, fbApproachBars: saved.fb?.approachBars ?? 4, fbApproachAtr: saved.fb?.approachAtr ?? 2, fbVol: saved.fb?.vol ?? 3,
    baBars: saved.ba?.bars ?? 6, baNear: saved.ba?.near ?? 1,
    taRise: saved.ta?.rise ?? 2, taRiseBars: saved.ta?.riseBars ?? 10, taShare: saved.ta?.share ?? 0.2, taOiBars: saved.ta?.oiBars ?? 3,
    taZ: saved.ta?.z ?? 2, taAdvance: saved.ta?.advance ?? 0.5, taSource: saved.ta?.source || 'sum',
    poMove: saved.po?.move ?? 3, poBars: saved.po?.bars ?? 6, poVol: saved.po?.vol ?? 3, poOiBars: saved.po?.oiBars ?? 2,
    poZ: saved.po?.z ?? 2, poSource: saved.po?.source || 'sum',
    daleAway: saved.dale?.away ?? 2, daleMinDay: saved.dale?.minDay ?? 0.1, daleMaxDay: saved.dale?.maxDay ?? 0.2, daleBuffer: saved.dale?.buffer ?? 0.1,
    daleRun: saved.dale?.run ?? 3, daleLeg: saved.dale?.leg ?? 3, daleMinLeg: saved.dale?.minLeg ?? 5, daleBump: saved.dale?.bump ?? 1.5,
    cvdOn: !!saved.flow?.cvd, cvdBars: saved.flow?.cvd ?? 20, oiMode: saved.flow?.oi || 'off', oiBars: saved.flow?.oiBars ?? 6, oiPct: saved.flow?.oiPct ?? 2,
    crowdMode: saved.flow?.crowd || 'off', steadyOn: !!saved.flow?.steady, steadyDays: saved.flow?.steadyDays ?? 14, steadyMin: saved.flow?.steadyMin ?? 0.52,
    chainMetric: saved.flow?.chain?.metric || 'off', chainAsset: saved.flow?.chain?.asset || 'auto', chainDays: saved.flow?.chain?.days ?? 7,
    chainZ: saved.flow?.chain?.z ?? 0.5, chainMode: saved.flow?.chain?.mode || 'favor',
    regimeMode: saved.regime?.mode || 'any', regimeMajor: saved.regime ? saved.regime.major !== false : true,
    regimeMajorOut: saved.regime?.majorOut ?? 6, regimeAfter: saved.regime?.after ?? 6, regimeDaily: saved.regime?.tf === DAILY_TF,
    vpShapes: saved.vp?.shapes || [], vpVeEntry: saved.vp?.veEntry || 'touch', vpHours: saved.vp?.hours ?? 24, vpAccept: saved.vp?.accept ?? 30, vpFailBars: saved.vp?.failBars ?? 3,
    trail: saved.exit?.trail === 'swing', trailBars: saved.exit?.trailBars ?? 5,
    useHorizon: saved.exit?.horizon != null, horizon: saved.exit?.horizon ?? 200, opposite: !!saved.exit?.opposite,
    oneAtATime: saved.oneAtATime !== false, cooldown: saved.cooldown ?? 0, vaGap: saved.vaGap ?? 0, filters: saved.filters || [],
    volFilter: saved.volFilter ?? 2, target: saved.target ?? 0.05
  };
}

/** Medidas del filtro de flujos on-chain (onchain_flows.py) */
export const CHAIN_METRICS = ['net', 'stable'];

/** La medida del objetivo mixto en palabras: «la emisión de USDT y USDC de 30 d a favor» */
export const chainTargetText = (ct) => `${ct.metric === 'net' ? `el flujo neto${ct.asset && ct.asset !== 'auto' ? ` de ${ct.asset.toUpperCase()}` : ''} a exchanges` : 'la emisión de USDT y USDC'} de ${ct.days} d a favor (z ≥ ${ct.z})`;

/** El filtro de flujos on-chain en palabras: «flujo neto de BTC a exchanges en 7 d a favor (z ≥ 0.5)» */
export function chainText(chain) {
  if (!chain) return '';
  const asset = chain.metric === 'net' ? (chain.asset && chain.asset !== 'auto' ? ` de ${chain.asset.toUpperCase()}` : ' de BTC o ETH') : '';
  const what = chain.metric === 'net' ? `flujo neto${asset} a exchanges` : 'emisión de USDT y USDC';
  const how = chain.mode === 'nocontra' ? `no en contra (z > −${chain.z})` : `a favor (z ≥ ${chain.z})`;
  return `${what} en ${chain.days} d ${how}`;
}

/** La distancia del objetivo arrastrado en palabras: «0.5R», «1 ATR», «1%» */
export const tpTrailText = (tp) => (tp.unit === 'atr' ? `${tp.dist} ATR` : tp.unit === 'pct' ? `${tp.dist}%` : `${tp.dist}R`);

/** La regla en una línea, para el historial y el encabezado del informe */
export function describeRule(saved) {
  const L = (text) => elementLabels(String(text).split('+'));
  if (!saved?.recipe) return '';
  const recipe = saved.recipe;
  const codes = (recipe.slots || []).map(slot => L((slot.codes || []).join('|')));
  const raw = (recipe.slots || []).flatMap(slot => slot.codes || []); // Los códigos: `codes` son sus nombres
  const part = (group) => (recipe.slots || []).filter(slot => (slot.group || 0) === group).map(slot => L((slot.codes || []).join('|')));
  const liq = saved.liq ? ` (${saved.liq.what === 'zone' ? 'zona' : `swing ${saved.liq.swingBars}`}, ${saved.liq.variant === 'reclaim' ? 'recupera' : 'perfora'})` : '';
  // El gatillo de una secuencia pide al menos groupMins[1] de sus elementos: «2 de A, B, C»; todos van con «+» y uno, con «o»
  const triggers = part(1);
  const need = Number(recipe.groupMins?.[1] ?? 1);
  const triggerText = triggers.length > 1 && need > 1 && need < triggers.length ? `${need} de ${triggers.join(', ')}` : triggers.join(need >= triggers.length ? ' + ' : ' o ');
  const joined = (recipe.mode === 'sequence' ? `${part(0).join(' + ')} → ${triggerText}`
    : recipe.mode === 'threshold' && recipe.min < codes.length ? `${recipe.min} de ${codes.join(', ')}` : codes.join(' + ')) + liq;
  const stop = { swing: `swing ${saved.stop?.bars}`, candle: 'vela del elemento', zone: 'borde de la zona', atr: `${saved.stop?.atr} ATR` }[saved.stop?.type] || '';
  const exits = [];
  if (saved.targetAt === 'weak') exits.push('máximo o mínimo del rango SMC');
  else if (saved.targetAt) exits.push(saved.be && !saved.vp ? 'centro de la caja' : { poc: 'POC anterior', edge: 'borde contrario del valor', mid: 'centro del rango anterior' }[saved.targetAt]);
  else if (saved.exit?.tpTrail) exits.push(`${saved.exit.targetR}R arrastrado desde ${saved.exit.tpTrail.start}R a ${tpTrailText(saved.exit.tpTrail)}`);
  else if (saved.exit?.chainTarget) exits.push(`${saved.exit.targetR}R (${saved.exit.chainTarget.r}R con ${chainTargetText(saved.exit.chainTarget)})`);
  else if (saved.exit?.targetR != null) exits.push(`${saved.exit.targetR}R`);
  if (saved.exit?.trail === 'swing') exits.push('stop arrastrado');
  if (saved.exit?.trail === 'bars') exits.push(`stop bajo el mínimo de ${saved.exit.trailBars} velas`);
  if (saved.exit?.trail === 'atr') exits.push(`trailing a ${saved.exit.trailAtr} ATR${saved.exit.trailStart ? ` desde ${saved.exit.trailStart}R` : ''}`);
  if (saved.exit?.trail === 'pct') exits.push(`trailing a ${saved.exit.trailPct}%${saved.exit.trailStart ? ` desde ${saved.exit.trailStart}R` : ''}`);
  if (saved.exit?.breakEven) exits.push(`stop a la entrada en ${saved.exit.breakEven}R`);
  if (saved.exit?.vpa) exits.push(`salida VPA: ${vpaExitText(saved.exit.vpa)}`);
  if (saved.exit?.horizon != null) exits.push(`${saved.exit.horizon} velas`);
  if (saved.exit?.opposite) exits.push('señal contraria');
  if (saved.gc && saved.gc.exit !== 'none') exits.push(saved.gc.exit === 'mid' ? 'cierre al otro lado de la línea central' : 'cierre de vuelta dentro de la banda');
  return `${TF_LABEL[saved.tf] || saved.tf} · ${joined}${recipe.window > 1 ? ` @${recipe.window}` : ''}${saved.invert ? ' · invertida' : ''}`
    + `${saved.vaGap > 0 ? ` · hueco ≥ ${saved.vaGap} ATR` : ''}`
    + `${saved.flow?.cvd ? ` · CVD ${saved.flow.cvd} a favor` : ''}`
    + `${saved.flow?.crowd ? ` · ${saved.flow.crowd === 'contra' ? 'solo contra la multitud' : 'sin ir con la multitud'}` : ''}`
    + `${saved.flow?.steady ? ` · OI sostenido ≥ ${Math.round(saved.flow.steadyMin * 100)}% en ${saved.flow.steadyDays} d` : ''}`
    + `${saved.flow?.chain ? ` · ${chainText(saved.flow.chain)}` : ''}`
    + `${saved.flow?.oi ? ` · ${{ rise: `OI sube > ${saved.flow.oiPct}% en ${saved.flow.oiBars}`, fall: `OI baja > ${saved.flow.oiPct}% en ${saved.flow.oiBars}`, conf: 'confluencia OI-vol a favor', noconf: 'sin confluencia OI-vol en contra' }[saved.flow.oi]}` : ''}`
    + `${saved.be?.pattern ? ' · borde con patrón' : ''}`
    + `${saved.regime ? ` · ${{ inside: 'solo en rango', outside: 'solo fuera de rango', breakout: `${saved.regime.after} velas tras romper` }[saved.regime.mode]}${saved.regime.major ? ' mayor' : ''}` : ''}`
    + `${saved.cc ? ` · estructura ${saved.cc.tf >= 60 ? `${saved.cc.tf / 60} h` : `${saved.cc.tf} m`}, swing ${saved.cc.swing}` : ''}`
    + `${saved.pat ? ` · patrón${saved.pat.trend ? ' tras tendencia' : ''}${saved.pat.minZ != null ? `, z ≥ ${saved.pat.minZ}` : ''}` : ''}`
    + `${saved.rv ? ` · tramo ${saved.rv.leg} ATR${raw.includes('RF') ? `, flecha ≥ ${saved.rv.spike}x ${{ with: 'a favor del tramo', against: 'contra el tramo', any: 'de cualquier lado' }[saved.rv.arrow]}` : ''}${raw.includes('RB') ? `, rombo ${saved.rv.rombo === 'follow' ? 'siguiendo el tramo' : 'como giro'}` : ''}` : ''}`
    + `${saved.gc ? ` · canal ${saved.gc.period}, ${saved.gc.poles} polos, ×${saved.gc.mult}${saved.gc.trend ? ', a favor' : ''}` : ''}`
    + (saved.lines || []).map(l => ` · ${l.mode === 'touch' ? 'toca' : 'a favor de'} ${l.type === 'vwap' ? 'VWAP' : 'EMA'} ${l.period}${vpaFrameText(l.tf)}${l.slope ? ' con pendiente' : ''}${l.maxDev ? `, abre a ${l.maxDev} desv. o menos` : ''}`).join('')
    + `${saved.hours ? ` · ${clock(saved.hours.from)}–${clock(saved.hours.to)} UTC` : ''}`
    + `${saved.vp ? ` · perfil de ${saved.vp.hours} h${saved.vp.shapes?.length ? ` (${saved.vp.shapes.join(', ')})` : ''}` : ''}`
    // La angulación y el AO en contra son de la barra divergente: con solo el AO de tres barras o el fractal confundían
    + `${saved.wise && raw.includes('WD') ? ` · angulación de ${saved.wise.angBars} velas${saved.wise.requireAo ? ', AO en contra' : ''}` : ''}`
    + `${saved.smc ? ` · estructura ${saved.smc.scope === 'internal' ? `interna de ${saved.smc.internal}` : `mayor de ${saved.smc.swing}`} velas${saved.smc.break !== 'any' ? `, solo ${saved.smc.break === 'bos' ? 'BOS' : 'CHoCH'}` : ''}` : ''}`
    + `${saved.bwf?.alligator ? ` · ${{ awake: 'Alligator despierto a favor', side: 'cierre del lado de los dientes', sleeping: 'Alligator dormido' }[saved.bwf.alligator]}` : ''}`
    + `${saved.bwf?.zone ? ' · zona de Williams a favor' : ''}`
    + `${saved.bwf?.ao ? ` · AO ${BW_MOMENTUM_TEXT[saved.bwf.ao]}` : ''}${saved.bwf?.ac ? ` · AC ${BW_MOMENTUM_TEXT[saved.bwf.ac]}` : ''}`
    + `${saved.bwf?.gator ? ` · Gator ${BW_GATOR_TEXT[saved.bwf.gator]?.split(' (')[0]}` : ''}${saved.bwf?.mfi ? ` · MFI ${BW_MFI_TEXT[saved.bwf.mfi]?.split(' (')[0]}` : ''}`
    + `${saved.smcf?.pd ? ' · largos en discount, cortos en premium' : ''}${saved.smcf?.bias ? ' · a favor de la estructura mayor' : ''}`
    + `${saved.vpa && raw.some(code => VPA_CODES.includes(code)) ? ` · VPA desde ${Math.round(saved.vpa.fire * 100)}%` : ''}`
    + `${saved.vpaf ? ` · ${VPA_FILTER_TEXT[saved.vpaf.mode]}${vpaFrameText(saved.vpaf.tf)} (${{ favor: '≥', notFavor: '<' }[saved.vpaf.mode] || '> −'}${saved.vpaf.thr})` : ''}`
    + ` · ${saved.entry?.type === 'limit' ? 'limit' : saved.entry?.type === 'straddle' ? `dos órdenes stop a ${saved.entry.offset} ATR ${saved.entry.from === 'zone' ? 'fuera de la zona' : 'del cierre'}`
      : saved.entry?.type === 'stop' ? `orden stop en el borde de la zona${saved.entry.offset ? ` + ${saved.entry.offset} ATR` : ''}` : 'mercado'} · stop ${stop} · ${exits.join(', ') || 'sin objetivo'}`
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
/**
 * Las cajas de los trades. Un trade sin objetivo (trailing, tiempo, señal contraria) no tiene zona TP: su caja es la del
 * riesgo, y su salida va como una marca al final (noTarget, exit). Hasta el 20/11/2026 la salida se pintaba como TP: un
 * ganador salía con su zona verde y uno que salió en la entrada o perdiendo, solo con la roja
 */
export function tradeBoxes(trades = [], tfMinutes = 15) {
  return trades.map(trade => ({
    side: trade.dir > 0 ? 'long' : 'short', entry: trade.entry, stop: trade.stop,
    target: trade.target ?? null, noTarget: trade.target == null, exit: trade.exit, start: trade.entry_t,
    end: Math.max(trade.exit_t, trade.entry_t + tfMinutes * 60000)
  }));
}

/** Motivos de salida, en palabras para la marca del trade elegido */
const EXIT_TEXT = {
  tiempo: 'por tiempo', stop: 'en el stop inicial', 'stop en la entrada': 'en el stop a la entrada', 'stop arrastrado': 'en el stop arrastrado',
  objetivo: 'en el objetivo', 'objetivo arrastrado': 'en el objetivo arrastrado', 'señal contraria': 'por la señal contraria', 'sale del canal': 'al salir del canal', 'hueco de datos': 'por un hueco de datos'
};

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
    bands.push({ kind: 'element', low: mark.lo, high: mark.hi, start: mark.t, end, strong: false, label: elementLabel(mark.code, names[mark.code]) });
  }
  if (Number.isFinite(trade.exit) && Number.isFinite(trade.exit_t)) {
    // Dónde y por qué salió, con su resultado: sin objetivo, la caja ya no lo pinta como TP
    // Por tiempo sale al cierre de la vela; por señal contraria o el canal, en la apertura de la siguiente: en el borde
    const byVpa = String(trade.reason || '').startsWith('VPA: ');
    const atEdge = byVpa || ['tiempo', 'señal contraria', 'sale del canal', 'hueco de datos'].includes(trade.reason);
    const why = byVpa ? `por el VPA (${trade.reason.slice(5)})` : (EXIT_TEXT[trade.reason] || trade.reason);
    bands.push({ kind: 'exit', time: trade.exit_t, price: trade.exit, good: trade.r > 0, atEdge, label: `Salida ${why} · ${fmtR(trade.r)} R` });
  }
  return bands;
}

/**
 * Lo que usó la regla alrededor del trade elegido (20/11/2026, para depurar): lo que da el backend en
 * /api/tester/result/{id}/trade/{n}/context (rule_tester.trade_context), como franjas para el gráfico. Va debajo de
 * las de tradeBands():
 * - las cajas del régimen;
 * - todas las apariciones de los elementos de la regla, tenues;
 * - sus líneas enteras: EMA, VWAP móvil con su tope y canal gaussiano;
 * - una fila por filtro bajo las velas, que dice en cada vela si pasa para el lado del trade;
 * - las señales de la regla en la ventana: la del trade y las que no entraron.
 */
export function contextBands(context, names = {}) {
  if (!context?.success) return [];
  const tf = context.tf * 60000;
  const bands = [];
  for (const box of context.regime?.boxes || []) {
    const tone = box.major ? 'major' : undefined;
    if (box.start < box.known) bands.push({ kind: 'outline', tone, low: box.low, high: box.high, start: box.start, end: box.known, strong: false });
    bands.push({ kind: 'outline', tone, low: box.low, high: box.high, start: box.known, end: box.end, strong: true });
  }
  for (const e of context.elements || []) {
    if (!Number.isFinite(e.lo) || !Number.isFinite(e.hi)) continue;
    bands.push({ kind: 'event', dir: e.dir, low: e.lo, high: e.hi, start: e.t, end: Math.max(e.known, e.t + tf) + tf, label: `${e.dir > 0 ? '▲' : '▼'} ${elementLabel(e.code, names[e.code])}` });
  }
  for (const line of context.lines || []) {
    bands.push({ kind: 'line', tf, tone: line.type, points: line.points, label: line.label });
    if (line.limit?.length) bands.push({ kind: 'line', tf, tone: line.type, points: line.limit, label: line.limitLabel, dash: true });
  }
  if (context.channel) {
    const { mid, high, low } = context.channel;
    bands.push({ kind: 'line', tf, tone: 'channel', points: mid, label: 'Línea central' });
    bands.push({ kind: 'line', tf, tone: 'channel', points: high, label: 'Banda superior', dash: true });
    bands.push({ kind: 'line', tf, tone: 'channel', points: low, label: 'Banda inferior', dash: true });
  }
  // El stop de cada vela del trade: inicial, a la entrada y arrastrado, para revisar el trailing
  if (context.stopPath?.length) bands.push({ kind: 'steps', tf, points: context.stopPath });
  // El trailing del objetivo: dónde se activa (hasta que se activó o, si nunca llegó, hasta la salida) y, desde ahí, el
  // objetivo arrastrado al cerrar cada vela, en escalones verdes. El rótulo del arranque va del lado donde no hay velas
  // mientras no se activa (arriba en un largo, abajo en un corto); el de los escalones, solo si duran más de una vela
  // (si no, la salida ya lo dice y se pisarían)
  const tpStart = context.tpStart;
  if (tpStart && Number.isFinite(tpStart.price) && context.stopPath?.length) {
    const first = context.stopPath[0][0];
    const reached = Number.isFinite(tpStart.t);
    bands.push({
      kind: 'level', price: tpStart.price, start: first, end: reached ? Math.max(first + tf, tpStart.t) : context.stopPath[context.stopPath.length - 1][0] + tf,
      label: `Se activa el trailing · ${tpStart.r}R${reached ? '' : ' (no llegó)'}`, labelBelow: context.side < 0
    });
  }
  if (context.tpPath?.length) {
    bands.push({
      kind: 'steps', tf, points: context.tpPath.map(([t, price]) => [t, price, 'objetivo']),
      label: context.tpPath.length > 1 ? 'objetivo arrastrado' : '', labelAbove: context.side < 0
    });
  }
  const rows = context.rows || [];
  rows.forEach((row, i) => bands.push({ kind: 'ticks', tf, row: i, rows: rows.length, label: row.label, items: row.items }));
  for (const s of context.signals || []) {
    bands.push({ kind: 'signal', tf, rows: rows.length, time: s.t, dir: s.dir, taken: s.what === 'trade', label: s.what === 'trade' ? `T${s.n}` : '' });
  }
  return bands;
}

/** Las señales de la ventana que no entraron, con su motivo, para la lista del trade elegido */
export function skippedSignals(context) {
  return (context?.signals || []).filter(s => s.what !== 'trade');
}

/**
 * Cada condición de la regla al cerrar la vela de la señal, que es cuando decidió (pedido del usuario: ver de un
 * vistazo si al abrir el trade se cumplía todo). Primero los elementos (los que dispararon con ✓), después cada filtro
 * de las filas con su valor. ok: true se cumple, false no, null sin dato. Un trade que se repite igual tiene todo en ✓:
 * un ✗ dice que algo no cuadra. null si el contexto no llegó.
 */
export function signalChecklist(context, trade, recipe, names = {}) {
  if (!context?.success || !trade) return null;
  const items = [];
  if (recipe?.slots?.length) {
    const codes = [...new Set(recipe.slots.flatMap(slot => slot.codes))];
    const votes = new Set(trade.votes || []);
    const how = recipe.mode === 'threshold' && recipe.min < codes.length ? `al menos ${recipe.min} de ${codes.length}`
      : recipe.mode === 'sequence' ? 'en secuencia' : recipe.mode === 'groups' ? 'por grupos' : codes.length > 1 ? 'todos' : '';
    const within = recipe.window > 1 ? `en ${recipe.window} velas` : '';
    const detail = [how, within].filter(Boolean).join(', ');
    items.push({
      ok: codes.some(code => votes.has(code)), label: `Elementos${detail ? ` (${detail})` : ''}`,
      note: codes.map(code => `${votes.has(code) ? '✓' : '✗'} ${elementLabel(code, names[code])}`).join('  ')
    });
  }
  for (const row of context.rows || []) {
    const state = row.items.find(([t]) => t === context.signal)?.[1];
    items.push({ ok: state === 1 ? true : state === 0 ? false : null, label: row.label, note: row.note || '' });
  }
  return { time: context.signal, entry: trade.entry_t, dir: trade.dir, items, all: items.length > 0 && items.every(item => item.ok === true) };
}

/** El cuadro de la señal para el gráfico: resalta su vela y lista cada condición */
export function checklistBand(check, context, title) {
  if (!check) return null;
  // below: en un largo el cuadro va abajo, porque el trade sube (con su objetivo arrastrado) por donde iría arriba
  return { kind: 'checklist', tf: context.tf * 60000, rows: (context.rows || []).length, time: check.time, title, items: check.items, below: context.side > 0 };
}

// ==================== LOS INDICADORES DE LA REGLA EN EL TRADE ELEGIDO (21/11) ====================
// Pedido del usuario: al elegir un trade no se veían los indicadores que usó la regla (solo sus marcas y sus filas).
// Ahora el gráfico los enciende mientras se ve lo que usó la regla, en su marco, y los de Williams y SMC con los ajustes
// con que calculó el backend. Las líneas (EMA, VWAP, canal), las cajas y las marcas de los elementos las sigue dibujando
// el contexto del trade

// En el orden de la lista de indicadores del gráfico (WISE_CODES y SMC_CODES, arriba)
const RULE_INDICATOR_ORDER = ['CVD', 'Open Interest', 'OI-Volume Confluence', 'Estructura SMC', 'Alligator', 'Fractales', 'Tres sabios',
  'Zonas de Williams', 'AO', 'AC', 'Gator', 'MFI'];
const CHART_TF_MINUTES = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240 };

const ruleCodes = (rule) => new Set((rule?.recipe?.slots || []).flatMap(slot => slot.codes || []));

/** El marco del gráfico con las velas de la regla ('4h' para una de 240 minutos), o null si el gráfico no lo tiene (30m, 1D) */
export function chartTfOf(ruleTf) {
  return CHART_TIMEFRAMES.find(tf => CHART_TF_MINUTES[tf] === Number(ruleTf)) || null;
}

/**
 * Los indicadores del gráfico que usa una regla (en la forma del backend): los de Williams y la estructura SMC de sus
 * elementos y filtros, y los paneles de los datos que leen sus filtros de flujo (CVD e interés abierto)
 */
export function ruleIndicators(rule) {
  if (!rule?.recipe) return [];
  const codes = ruleCodes(rule);
  const bwf = rule.bwf || {};
  const flow = rule.flow || {};
  const wise = rule.wise || {};
  const names = new Set();
  if (WISE_CODES.some(code => codes.has(code))) names.add('Tres sabios');
  // La barra divergente se mide contra la boca, y la ruptura de fractal (por omisión) del lado de los dientes
  if (codes.has('WD') || (codes.has('WF') && wise.teeth !== false) || bwf.alligator) names.add('Alligator');
  if (codes.has('WF')) names.add('Fractales');
  if (codes.has('WA') || (codes.has('WD') && wise.requireAo !== false) || bwf.ao) names.add('AO');
  if (bwf.ac) names.add('AC');
  if (bwf.zone) names.add('Zonas de Williams');
  if (bwf.gator) names.add('Gator');
  if (bwf.mfi) names.add('MFI');
  if (SMC_CODES.some(code => codes.has(code)) || rule.smcf?.pd || rule.smcf?.bias || rule.targetAt === 'weak') names.add('Estructura SMC');
  if (flow.cvd) names.add('CVD');
  if (['rise', 'fall'].includes(flow.oi) || flow.steady) names.add('Open Interest');
  if (['conf', 'noconf'].includes(flow.oi)) names.add('OI-Volume Confluence');
  return RULE_INDICATOR_ORDER.filter(name => names.has(name));
}

/**
 * Los ajustes de Williams con que calculó la regla (backend/williams.py: los de fábrica, y los de sus sabios) sobre los
 * del gráfico: cambia solo lo que mueve el cálculo, y el gráfico conserva sus colores y lo que muestra. Sin sabios en la
 * regla, los del gráfico quedan como estaban
 */
export function ruleWilliamsConfig(rule, current = defaultWilliamsConfig()) {
  const base = defaultWilliamsConfig();
  const codes = ruleCodes(rule);
  const take = (from, keys) => Object.fromEntries(keys.map(key => [key, from[key]]));
  const out = {
    ...current,
    alligator: { ...current.alligator, ...take(base.alligator, ['jawLen', 'jawShift', 'teethLen', 'teethShift', 'lipsLen', 'lipsShift', 'sleepAtr']) },
    fractals: { ...current.fractals, maxRight: base.fractals.maxRight },
    ao: { ...current.ao, fast: base.ao.fast, slow: base.ao.slow },
    ac: { ...current.ac, signal: base.ac.signal }
  };
  if (WISE_CODES.some(code => codes.has(code))) {
    const wise = rule.wise || {};
    const entry = rule.entry || {};
    const expiry = Number(entry.expiry);
    out.wise = {
      ...current.wise,
      first: codes.has('WD'), second: codes.has('WA'), third: codes.has('WF'), // Solo los sabios de la regla
      lookback: wise.lookback ?? base.wise.lookback, angBars: wise.angBars ?? base.wise.angBars,
      minGapAtr: wise.minGapAtr ?? base.wise.minGapAtr, requireAo: wise.requireAo !== false, alligatorFilter: wise.teeth !== false,
      // Lo que espera la orden stop de la regla; a mercado, lo de fábrica
      pendingBars: entry.type === 'stop' && expiry > 0 ? expiry : base.wise.pendingBars
    };
  }
  return out;
}

/**
 * Los ajustes de la estructura SMC con que calculó la regla (backend/smc.py: los de sus elementos y sus filtros) sobre
 * los del gráfico, con las zonas premium/discount a la vista si la regla las usa y el extremo débil si su objetivo es él
 */
export function ruleSmcConfig(rule, current = defaultSmcConfig()) {
  const smc = rule?.smc || {};
  const smcf = rule?.smcf || {};
  return {
    ...current,
    internal: { ...current.internal, length: smc.internal ?? current.internal.length },
    swing: { ...current.swing, length: smcf.swing ?? smc.swing ?? current.swing.length },
    ob: { ...current.ob, pick: smc.pick ?? current.ob.pick, area: smc.area ?? current.ob.area, mitigation: smc.mitigation ?? current.ob.mitigation },
    equal: { ...current.equal, length: smc.eqLength ?? current.equal.length, threshold: smc.eqThreshold ?? current.equal.threshold },
    zones: smcf.pd ? { ...current.zones, show: true } : current.zones,
    strongWeak: rule?.targetAt === 'weak' ? { ...current.strongWeak, show: true } : current.strongWeak
  };
}

/** Los nombres en una lista: «Alligator, Fractales y AO» */
export const listText = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}` : names[0] || '');

export const fmtR =(value, digits = 2) => (value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${Number(value).toFixed(digits)}`);
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
