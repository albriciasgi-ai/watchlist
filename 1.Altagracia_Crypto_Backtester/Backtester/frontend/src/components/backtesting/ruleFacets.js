/**
 * Las piezas de una regla del probador, en palabras (pedido del usuario, 20/11/2026: el panel de la regla escondía
 * opciones activas, y una corrida salió con un trailing y dos filtros que no sabía que tenía).
 *
 * ruleFacets() lee una regla en la forma del backend: la que arma toBackendRule() o la que guarda una corrida, que pasó
 * por clean_rule(). Las dos dan las mismas palabras para lo mismo, así que de ellas salen:
 * - el resumen «Vas a correr» sobre el botón de correr;
 * - las diferencias entre el formulario y la corrida a la vista;
 * - lo que trae una regla al cargarla;
 * - el resumen de cada sección plegada.
 * Lógica pura: se prueba en Node.
 */
import { elementLabels } from './elementLabels.js';
import { BW_ALLIGATOR_TEXT, BW_GATOR_TEXT, BW_MFI_TEXT, BW_MOMENTUM_TEXT, DAILY_TF, TF_LABEL, VP_CODES, chainText, tpTrailText, vpaExitText } from './ruleTester.js';

/** Secciones del formulario, en orden */
export const SECTIONS = [
  ['elementos', 'Elementos que disparan'], ['filtros', 'Filtros'], ['entrada', 'Entrada'], ['stop', 'Stop'],
  ['salida', 'Salida'], ['deteccion', 'Detección de los elementos']
];

/** Cada pieza: su sección, su nombre y lo que dice cuando no está (para las diferencias) */
export const FACETS = {
  tf: ['elementos', 'Marco'],
  elementos: ['elementos', 'Elementos'],
  lado: ['elementos', 'Lado', 'alcistas y bajistas'],
  liq: ['elementos', 'Barrido de liquidaciones'],
  cc: ['elementos', 'Cambio de carácter'],
  pat: ['elementos', 'Patrones de vela'],
  rv: ['elementos', 'Volumen de Respuesta'],
  gc: ['elementos', 'Gaussian Channel'],
  bx: ['elementos', 'Ruptura de caja'],
  be: ['elementos', 'Borde de caja'],
  cp: ['elementos', 'Compresión'],
  im: ['elementos', 'Impulso'],
  fv: ['elementos', 'FVG nuevo'],
  sp: ['elementos', 'Swing'],
  wise: ['elementos', 'Tres sabios'],
  smc: ['elementos', 'Estructura SMC'],
  vpa: ['elementos', 'Lector VPA'],
  vp: ['elementos', 'Perfil por sesión'],
  vaGap: ['elementos', 'Área de valor abandonada', 'sin hueco mínimo'],
  vwap: ['filtros', 'VWAP', 'sin filtro'],
  ema: ['filtros', 'EMA', 'sin filtro'],
  regimen: ['filtros', 'Régimen', 'cualquiera'],
  cvd: ['filtros', 'CVD', 'sin filtro'],
  oi: ['filtros', 'Interés abierto', 'sin filtro'],
  multitud: ['filtros', 'Multitud', 'sin filtro'],
  oiSostenido: ['filtros', 'OI sostenido', 'sin filtro'],
  onchain: ['filtros', 'Flujos on-chain', 'sin filtro'],
  alligator: ['filtros', 'Alligator', 'sin filtro'],
  zonaWilliams: ['filtros', 'Zona de Williams', 'sin filtro'],
  ao: ['filtros', 'AO', 'sin filtro'],
  ac: ['filtros', 'AC', 'sin filtro'],
  gator: ['filtros', 'Gator', 'sin filtro'],
  mfi: ['filtros', 'MFI', 'sin filtro'],
  vpaMedidor: ['filtros', 'Medidor VPA', 'sin filtro'],
  premium: ['filtros', 'Premium y discount', 'sin filtro'],
  sesgo: ['filtros', 'Tendencia de la estructura', 'sin filtro'],
  extremo: ['filtros', 'En un extremo', 'no'],
  momentum: ['filtros', 'Momentum', 'no'],
  confirmacion: ['filtros', 'Confirmación', 'no'],
  horario: ['filtros', 'Horario', 'todo el día'],
  medidas: ['filtros', 'Medidas del Observador', 'ninguna'],
  entrada: ['entrada', 'Entrada'],
  stop: ['stop', 'Stop'],
  objetivo: ['salida', 'Objetivo', 'sin objetivo'],
  arrastre: ['salida', 'Arrastre del objetivo', 'no'],
  trailing: ['salida', 'Trailing del stop', 'sin trailing'],
  aLaEntrada: ['salida', 'Stop a la entrada', 'no'],
  tiempo: ['salida', 'Cierre por tiempo', 'no'],
  contraria: ['salida', 'Señal contraria', 'no'],
  canal: ['salida', 'Salida por el canal', 'no'],
  salidaVpa: ['salida', 'Salida VPA', 'no'],
  unaAlaVez: ['salida', 'Posiciones'],
  deteccion: ['deteccion', 'Detección']
};

const ORDER = Object.keys(FACETS);
const DEFAULT_HORIZON = 96; // rule_tester.DEFAULT_HORIZON: sin ninguna otra salida, el backend cierra a las 96 velas
const n = (value) => (value === null || value === undefined || value === '' ? value : Number(value));
const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const tfText = (minutes) => TF_LABEL[minutes] || (minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`);
const groupMin = (recipe, group) => Number(recipe.groupMins?.[group] ?? recipe.groupMins?.[String(group)] ?? 1);

/** Los elementos y cómo se combinan, en palabras: «Cambio de carácter → 2 de A, B, C, en 10 velas» */
export function recipeText(rule) {
  const recipe = rule?.recipe;
  if (!recipe?.slots?.length) return 'sin elementos';
  const label = (slot) => elementLabels([(slot.codes || []).join('|')]); // Una casilla con varios códigos: cualquiera de ellos
  const list = (slots, min) => {
    const labels = slots.map(label);
    if (labels.length <= 1) return labels.join('');
    if (min >= labels.length) return labels.join(' + ');
    return min <= 1 ? labels.join(' o ') : `${min} de ${labels.join(', ')}`;
  };
  const slots = recipe.slots;
  let text;
  if (recipe.mode === 'sequence') {
    const first = slots.filter(slot => (slot.group || 0) === 0);
    const trigger = slots.filter(slot => (slot.group || 0) === 1);
    text = `${first.map(label).join(' + ')} → ${list(trigger, groupMin(recipe, 1))}`;
  } else {
    text = list(slots, recipe.mode === 'threshold' ? Number(recipe.min) || 1 : slots.length);
  }
  const window = Number(recipe.window) || 1;
  return window > 1 ? `${text}, en ${window} velas` : text;
}

/**
 * Las piezas activas de una regla en la forma del backend, en el orden del formulario: [{key, section, label, text,
 * implicit}]. Lo apagado no sale. `implicit` marca lo que pone el backend sin que se pida (el cierre a las 96 velas de
 * una regla sin otra salida). `labels.measures` trae los nombres de las medidas del Observador.
 */
export function ruleFacets(rule, labels = {}) {
  if (!rule?.recipe) return [];
  const out = [];
  const add = (key, text, implicit = false) => {
    if (text === null || text === undefined || text === '') return;
    const [section, label] = FACETS[key];
    out.push({ key, section, label, text, ...(implicit ? { implicit: true } : {}) });
  };
  const recipe = rule.recipe;
  const codes = (recipe.slots || []).flatMap(slot => slot.codes || []);
  const has = (code) => codes.includes(code);
  const exit = rule.exit || {};
  const targetAt = rule.targetAt ?? exit.targetAt ?? null;

  add('tf', tfText(Number(rule.tf)));
  add('elementos', recipeText(rule));
  const side = { long: 'solo alcistas', short: 'solo bajistas' }[recipe.side];
  add('lado', [side, rule.invert ? 'invertida' : null].filter(Boolean).join(', '));
  if (rule.liq && has('LIQ')) {
    const liq = rule.liq;
    add('liq', `${liq.what === 'zone' ? 'la zona de lado a lado' : `un swing de ${liq.swingBars} velas`}, ${liq.variant === 'reclaim' ? `cierra de vuelta en ${liq.reclaimBars} velas` : 'basta pasarla'}`);
  }
  if (rule.cc && has('CC')) {
    const cc = rule.cc;
    const struct = Number(cc.tf) || Number(rule.tf);
    const offset = Number(cc.offset) % struct;
    add('cc', `estructura en ${tfText(struct)}${offset ? ` desde las ${clock(offset)} UTC` : ''}, swing de ${cc.swing}, ${cc.legs} tramos`);
  }
  if (rule.pat && codes.some(code => ['HM', 'EN', 'DJ'].includes(code))) {
    const pat = rule.pat;
    add('pat', `${pat.trend !== false ? `tras ${pat.trendBars} velas en contra` : 'sin tendencia previa'}${pat.minZ !== null && pat.minZ !== undefined ? `, volumen z ≥ ${n(pat.minZ)}` : ''}, mecha ≥ ${n(pat.wick)} cuerpos`);
  }
  if (rule.rv && (has('RF') || has('RB'))) {
    const rv = rule.rv;
    const arrow = { with: 'a favor del tramo', against: 'contra el tramo', any: 'de cualquier lado' }[rv.arrow];
    add('rv', `tramo de ${n(rv.leg)} ATR${has('RF') ? `, flecha ≥ ${n(rv.spike)}x ${arrow}` : ''}${has('RB') ? `, rombo ${rv.rombo === 'follow' ? 'siguiendo el tramo' : 'como giro'}` : ''}`);
  }
  if (rule.gc && has('GC')) add('gc', `periodo ${rule.gc.period}, ${rule.gc.poles} polos, ancho ×${n(rule.gc.mult)}${rule.gc.trend !== false ? ', canal a favor' : ''}`);
  if (rule.bx && has('BX')) add('bx', rule.bx.maxHeight !== null && rule.bx.maxHeight !== undefined ? `cajas de hasta ${n(rule.bx.maxHeight)} ATR` : 'todas las cajas');
  if (rule.be && has('BE')) {
    const be = rule.be;
    add('be', `borde ${n(be.share)} de la caja, cuerpo ≤ ${n(be.maxBody)} ATR, cierra a ${n(be.rejection)}${be.pattern ? ', con patrón de rechazo' : ''}`);
  }
  if (rule.cp && has('CP')) add('cp', rule.cp.maxHeight !== null && rule.cp.maxHeight !== undefined ? `cajas de hasta ${n(rule.cp.maxHeight)} ATR` : 'todas las cajas');
  if (rule.im && has('IM')) add('im', `${n(rule.im.atr)} ATR en ${rule.im.bars} velas${rule.im.range !== null && rule.im.range !== undefined ? `, vela ≥ ${n(rule.im.range)} ATR` : ''}`);
  if (rule.fv && has('FV')) add('fv', `hueco ≥ ${n(rule.fv.minAtr)} ATR`);
  if (rule.wise && codes.some(code => ['WD', 'WA', 'WF'].includes(code))) {
    const w = rule.wise;
    add('wise', `${has('WD') ? `divergente bajo ${w.lookback} vela${w.lookback > 1 ? 's' : ''}, angulación de ${w.angBars}${n(w.minGapAtr) > 0 ? `, hueco ≥ ${n(w.minGapAtr)} ATR` : ''}${w.requireAo !== false ? ', AO en contra' : ''}` : ''}`
      + `${has('WF') ? `${has('WD') ? '; ' : ''}fractal ${w.teeth !== false ? 'del lado correcto de los dientes' : 'sin mirar los dientes'}` : ''}` || 'como el libro');
  }
  if (rule.vpa && codes.some(code => code.length === 2 && code[0] === 'Q')) {
    const q = rule.vpa;
    const parts = [`cuenta desde ${Math.round(Number(q.fire) * 100)}%`, `tramo de ${n(q.legAtr)} ATR`];
    if (has('QE')) parts.push(`medidor ±${n(q.meter)}, memoria ${n(q.decay)}`);
    if (has('QB') || has('QF') || has('QR')) parts.push(`rango de ${q.rangeBars} velas de hasta ${n(q.maxRangeAtr)} ATR`);
    if (has('QR')) parts.push(`retroceso en ${q.pullBars} velas`);
    add('vpa', parts.join(', '));
  }
  if (rule.smc && codes.some(code => ['BS', 'OB', 'BK', 'EQ'].includes(code))) {
    const m = rule.smc;
    const scope = m.scope === 'internal' ? `interna de ${m.internal} velas` : `mayor de ${m.swing} velas`;
    const parts = [`estructura ${scope}`];
    if (has('BS') && m.break !== 'any') parts.push(`solo ${m.break === 'bos' ? 'BOS' : 'CHoCH'}`);
    if (has('OB') || has('BK')) parts.push(`OB ${m.pick === 'opposite' ? 'la última vela contraria' : 'la vela del extremo'}${m.area === 'body' ? ', su cuerpo' : ''}, lo rompe ${m.mitigation === 'wick' ? 'una mecha' : 'un cierre'}`);
    if (has('EQ')) parts.push(`iguales de ${m.eqLength} velas a ${n(m.eqThreshold)} ATR${m.reclaim !== false ? ', con regreso' : ''}`);
    add('smc', parts.join(', '));
  }
  if (rule.sp && has('SP')) add('sp', `${rule.sp.bars} velas por lado${rule.sp.minZ !== null && rule.sp.minZ !== undefined ? `, volumen z ≥ ${n(rule.sp.minZ)}` : ''}`);
  const resting = !!rule.vp && has('VE') && rule.vp.veEntry === 'resting';
  if (rule.vp && codes.some(code => VP_CODES.includes(code))) {
    const vp = rule.vp;
    const shapes = (vp.shapes || []).length > 0 && vp.shapes.length < 4 ? `, formas ${vp.shapes.join(', ')}` : '';
    const ve = has('VE') ? (resting ? ', orden esperando en el borde' : ', tras tocar el borde') : '';
    add('vp', `sesión de ${vp.hours} h, sostenido ${vp.accept} min, fallo en ${vp.failBars} velas${shapes}${ve}`);
  }
  if (has('VA') && Number(rule.vaGap) > 0) add('vaGap', `hueco ≥ ${n(rule.vaGap)} ATR`);

  for (const line of rule.lines || []) {
    const text = `${line.type === 'vwap' ? 'VWAP' : 'EMA'} ${line.period} ${line.mode === 'touch' ? 'tocando' : 'a favor'}${line.slope ? ' con pendiente' : ''}${line.maxDev ? `, abre a ≤ ${n(line.maxDev)} desv.` : ''}`;
    add(line.type === 'vwap' ? 'vwap' : 'ema', text);
  }
  if (rule.regime?.mode) {
    const reg = rule.regime;
    const mode = { inside: 'solo dentro de un rango', outside: 'solo fuera de los rangos', breakout: `${reg.after} velas tras romper un rango` }[reg.mode];
    add('regimen', `${mode}${reg.major !== false ? `, rango mayor (termina tras ${reg.majorOut} cierres fuera)` : ', cajas chicas'}${Number(reg.tf) === DAILY_TF ? ', medido en 1D' : ''}`);
  }
  const flow = rule.flow || {};
  if (flow.cvd) add('cvd', `CVD de ${flow.cvd} velas a favor`);
  if (flow.oi) {
    add('oi', { rise: `OI sube más de ${n(flow.oiPct)}% en ${flow.oiBars} velas`, fall: `OI baja más de ${n(flow.oiPct)}% en ${flow.oiBars} velas`,
      conf: 'confluencia OI-volumen a favor', noconf: 'sin confluencia OI-volumen en contra' }[flow.oi]);
  }
  if (flow.crowd) add('multitud', flow.crowd === 'contra' ? 'solo contra la multitud' : 'sin ir con la multitud');
  // Cada filtro de Williams dice su nombre: en las fichas de «Vas a correr» va solo su texto
  if (rule.bwf?.alligator) add('alligator', BW_ALLIGATOR_TEXT[rule.bwf.alligator]);
  if (rule.bwf?.zone) add('zonaWilliams', 'zona de Williams a favor (verde en un largo, roja en un corto)');
  if (rule.bwf?.ao) add('ao', `AO ${BW_MOMENTUM_TEXT[rule.bwf.ao]}`);
  if (rule.bwf?.ac) add('ac', `AC ${BW_MOMENTUM_TEXT[rule.bwf.ac]}`);
  if (rule.bwf?.gator) add('gator', `Gator ${BW_GATOR_TEXT[rule.bwf.gator]}`);
  if (rule.bwf?.mfi) add('mfi', `MFI: ${BW_MFI_TEXT[rule.bwf.mfi]}`);
  if (rule.vpaf?.mode) add('vpaMedidor', rule.vpaf.mode === 'favor' ? `medidor VPA a favor (≥ ${n(rule.vpaf.thr)})` : `medidor VPA que no esté en contra (> −${n(rule.vpaf.thr)})`);
  if (rule.smcf?.pd) add('premium', `largos en discount y cortos en premium (rango mayor de ${rule.smcf.swing} velas)`);
  if (rule.smcf?.bias) add('sesgo', `a favor de la estructura mayor de ${rule.smcf.swing} velas`);
  if (flow.steady) add('oiSostenido', `OI sube en ${Math.round(Number(flow.steadyMin) * 100)}% o más de los pasos de ${flow.steadyDays} días`);
  if (flow.chain) add('onchain', chainText(flow.chain));
  if (recipe.swing?.on) add('extremo', `en un extremo de ${recipe.swing.bars} velas`);
  if (recipe.momentum) add('momentum', 'EMA 14 con pendiente a favor');
  if (recipe.entry?.on) add('confirmacion', `${n(recipe.entry.atr)} ATR a favor en ${recipe.entry.bars} velas`);
  if (rule.hours) add('horario', `${clock(Number(rule.hours.from))}–${clock(Number(rule.hours.to))} UTC${rule.hours.weekdays ? ', de lunes a viernes' : ''}`);
  if ((rule.filters || []).length) {
    add('medidas', rule.filters.map(f => `${labels.measures?.[f.key] || f.key} ${f.op === '<=' ? '≤' : '≥'} ${n(f.value)}`).join('; '));
  }

  const entry = rule.entry || {};
  if (resting) add('entrada', 'limit esperando en el borde del valor toda la sesión');
  else if (entry.type === 'limit') add('entrada', `limit en ${{ near: 'el borde cercano', mid: 'la mitad', far: 'el borde lejano' }[entry.at] || 'la zona'} de la zona, vence en ${entry.expiry} velas`);
  else if (entry.type === 'stop') add('entrada', `orden stop en el borde de la zona${n(entry.offset) > 0 ? ` + ${n(entry.offset)} ATR` : ''}, espera ${entry.expiry} velas${entry.cancel !== false ? ', se cancela si antes pasa el otro borde' : ''}`);
  else if (entry.type === 'straddle') add('entrada', `dos órdenes stop a ${n(entry.offset)} ATR ${entry.from === 'zone' ? 'por fuera de la zona' : 'del cierre'}, vencen en ${entry.expiry} velas`);
  else add('entrada', 'a mercado, en la apertura siguiente');

  const stop = rule.stop || {};
  const stopBase = { swing: `swing anterior de ${stop.bars} velas`, candle: 'extremo de la vela del elemento', zone: 'borde lejano de la zona', atr: `${n(stop.atr)} ATR` }[stop.type] || stop.type;
  add('stop', `${stopBase}${stop.type !== 'atr' ? ` (margen ${n(stop.buffer)} ATR)` : ''} · máximo ${n(stop.maxAtr)} ATR`);

  if (targetAt === 'weak') {
    add('objetivo', 'el máximo (largo) o el mínimo (corto) del rango mayor SMC');
  } else if (targetAt) {
    add('objetivo', targetAt === 'mid' && rule.be && !rule.vp ? 'el centro de la caja'
      : { poc: 'el POC anterior', edge: 'el borde contrario del valor', mid: 'el centro del rango anterior' }[targetAt]);
  } else if (exit.targetR !== null && exit.targetR !== undefined) {
    add('objetivo', `${n(exit.targetR)}R`);
    if (exit.tpTrail) add('arrastre', `desde ${n(exit.tpTrail.start)}R, a ${tpTrailText({ dist: n(exit.tpTrail.dist), unit: exit.tpTrail.unit })} del mejor precio`);
  }
  if (exit.trail === 'swing') add('trailing', `al último swing confirmado de ${exit.trailBars} velas`);
  if (exit.trail === 'bars') add('trailing', `bajo el mínimo (sobre el máximo) de las últimas ${exit.trailBars} velas`);
  if (exit.trail === 'atr' || exit.trail === 'pct') {
    const gap = exit.trail === 'atr' ? `${n(exit.trailAtr)} ATR` : `${n(exit.trailPct)}%`;
    add('trailing', `a ${gap} del mejor precio, ${exit.trailStart ? `desde ${n(exit.trailStart)}R` : 'desde la entrada'}`);
  }
  if (exit.breakEven) add('aLaEntrada', `al llegar a ${n(exit.breakEven)}R`);
  const channel = !!rule.gc && has('GC') && ['band', 'mid'].includes(rule.gc.exit);
  if (exit.horizon) add('tiempo', `a las ${exit.horizon} velas`);
  else if (!targetAt && (exit.targetR === null || exit.targetR === undefined) && (!exit.trail || exit.trail === 'none') && !channel && !exit.vpa) {
    add('tiempo', `a las ${DEFAULT_HORIZON} velas`, true); // Lo que hace el backend con una regla sin otra salida
  }
  if (exit.opposite) add('contraria', 'sí');
  if (exit.vpa) add('salidaVpa', `con ${vpaExitText(exit.vpa)}`);
  if (channel) add('canal', rule.gc.exit === 'mid' ? 'al cerrar al otro lado de la línea central' : 'al cerrar de vuelta dentro de la banda');
  const cooldown = Number(rule.cooldown) || 0;
  add('unaAlaVez', rule.oneAtATime !== false ? `una a la vez${cooldown > 0 ? `, espera ${cooldown} velas tras cerrar` : ''}` : 'todas las señales');
  add('deteccion', `volumen ${n(rule.volFilter)} · frecuencia ${n(rule.target)}`);
  return out.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
}

/**
 * Lo que cambia entre dos reglas en la forma del backend (el formulario y la corrida a la vista): [{key, label,
 * run, form}] en el orden del formulario. El nombre no cuenta, como en la identidad de la regla.
 */
export function ruleDifferences(formRule, runRule, labels = {}) {
  const map = (rule) => Object.fromEntries(ruleFacets(rule, labels).map(f => [f.key, f.text]));
  const form = map(formRule);
  const run = map(runRule);
  return ORDER.filter(key => (form[key] || null) !== (run[key] || null)).map(key => {
    const [, label, offText = 'no'] = FACETS[key];
    return { key, label, run: run[key] || offText, form: form[key] || offText };
  });
}

/** Cuántas piezas activas tiene cada sección. Salida no cuenta «Posiciones», que siempre está */
export function sectionCounts(facets) {
  const counts = {};
  for (const facet of facets) {
    if (facet.key === 'unaAlaVez' || facet.implicit) continue;
    counts[facet.section] = (counts[facet.section] || 0) + 1;
  }
  return counts;
}

/**
 * Una pieza en una frase corta, para las fichas de «Vas a correr» y los resúmenes. Los filtros y los elementos dicen lo
 * suyo («EMA 50 a favor»); la entrada, el stop y las salidas llevan su nombre delante («stop 2 ATR · máximo 8 ATR»,
 * «objetivo 2R») y los parámetros de un elemento, el del elemento («Cambio de carácter: estructura en 4h…»)
 */
export function facetPhrase(facet) {
  if (facet.key === 'contraria') return 'cierre con la señal contraria';
  if (facet.key === 'salidaVpa') return `salida VPA ${facet.text}`;
  if (facet.key === 'deteccion') return `detección: ${facet.text}`;
  if (facet.section === 'filtros' || ['tf', 'elementos', 'lado', 'unaAlaVez'].includes(facet.key)) return facet.text;
  if (facet.section === 'elementos') return `${facet.label}: ${facet.text}`;
  return `${facet.label.toLowerCase()} ${facet.text}`;
}

const withImplicit = (facet, text) => (facet.implicit ? `${text} (lo pone el backend)` : text);

/**
 * El resumen de una sección plegada: sus piezas en frases cortas, separadas por « · ». El marco va aparte, y la pieza
 * que da nombre a la sección (la entrada, el stop, la detección) va sin repetir su nombre
 */
export function sectionSummary(facets, section) {
  return facets.filter(f => f.section === section && f.key !== 'tf')
    .map(f => withImplicit(f, f.key === section ? f.text : facetPhrase(f))).join(' · ');
}

/**
 * Lo que trae una regla al cargarla: sus filtros, entrada, stop y salidas, sin los elementos (que se ven en las fichas)
 * ni la detección
 */
export function loadedSummary(rule, labels = {}) {
  return ruleFacets(rule, labels).filter(f => ['filtros', 'entrada', 'stop', 'salida'].includes(f.section) && f.key !== 'unaAlaVez')
    .map(f => withImplicit(f, facetPhrase(f)));
}

/** Cómo se apaga cada pieza en el formulario (las fichas de «Vas a correr» con su ×). null: no se apaga así */
export const OFF_PATCH = {
  vwap: { vwapMode: 'off' }, ema: { emaMode: 'off' }, regimen: { regimeMode: 'any' }, cvd: { cvdOn: false }, oi: { oiMode: 'off' },
  multitud: { crowdMode: 'off' }, oiSostenido: { steadyOn: false }, onchain: { chainMetric: 'off' }, alligator: { bwAlligator: 'off' }, zonaWilliams: { bwZone: false },
  ao: { bwAo: 'off' }, ac: { bwAc: 'off' }, gator: { bwGator: 'off' }, mfi: { bwMfi: 'off' }, vpaMedidor: { vpaMode: 'off' },
  premium: { smcPd: false }, sesgo: { smcBias: false }, extremo: { swing: false }, momentum: { momentum: false },
  confirmacion: { confirm: false }, horario: { useHours: false }, medidas: { filters: [] },
  objetivo: { useTarget: false }, arrastre: { tpTrailOn: false }, trailing: { trail: false, trailMode: 'off' }, aLaEntrada: { breakEvenOn: false },
  tiempo: { useHorizon: false }, contraria: { opposite: false }, canal: { gcExit: 'none' }, salidaVpa: { vpaExitOn: false }
};

/**
 * El embudo de las señales de una corrida: cuántas dio la regla, cuántas quitó cada filtro o motivo, y cuántos trades
 * cerrados quedaron. [{label, count, left}] con lo que queda tras cada paso; `left` del último son los trades
 */
export function signalFunnel(result) {
  if (!result || !Number.isFinite(result.signals)) return null;
  let left = result.signals;
  const steps = [{ label: 'Señales de los elementos', count: result.signals, left }];
  const take = (label, count) => {
    if (!(count > 0)) return;
    left -= count;
    steps.push({ label, count, left: Math.max(0, left) });
  };
  take('con una posición ya abierta', result.busy);
  Object.entries(result.skipped || {}).sort((a, b) => b[1] - a[1]).forEach(([why, count]) => take(why, count));
  take('abiertas al final de la fase', result.open);
  const trades = result.summary?.n ?? (result.trades || []).filter(t => !t.open).length;
  if (left - trades > 0) take('sin vela siguiente u otros motivos', left - trades);
  steps.push({ label: 'Trades cerrados', count: trades, left: trades, last: true });
  return steps;
}

/**
 * Las marcas de la escala en R de la salida, en R desde la entrada: el stop en −1, la entrada en 0, y lo que haya de
 * stop a la entrada, arranque del trailing, arranque del arrastre y objetivo. [{r, label, kind}] ordenadas
 */
export function exitScale(formRule) {
  const marks = [{ r: -1, label: 'stop', kind: 'stop' }, { r: 0, label: 'entrada', kind: 'entry' }];
  const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  const inR = !!formRule.useTarget && !(VP_CODES.some(code => (formRule.codes || []).includes(code)) && formRule.targetAt !== 'r')
    && !((formRule.codes || []).includes('BE') && formRule.targetAt === 'mid');
  if (formRule.breakEvenOn && num(formRule.breakEven) > 0) marks.push({ r: num(formRule.breakEven), label: 'a la entrada', kind: 'even' });
  const trailOn = formRule.trail || ['atr', 'pct'].includes(formRule.trailMode);
  if (trailOn && !formRule.trail && formRule.trailStartOn && num(formRule.trailStart) > 0) marks.push({ r: num(formRule.trailStart), label: 'trailing', kind: 'trail' });
  if (formRule.vpaExitOn && num(formRule.vpaExitFrom) > 0) marks.push({ r: num(formRule.vpaExitFrom), label: 'salida VPA', kind: 'trail' });
  if (inR && num(formRule.targetR) > 0) {
    if (formRule.tpTrailOn) marks.push({ r: Math.min(num(formRule.tpTrailStart) ?? 0, num(formRule.targetR)), label: 'arrastre', kind: 'drag' });
    marks.push({ r: num(formRule.targetR), label: 'objetivo', kind: 'target' });
  }
  return marks.sort((a, b) => a.r - b.r);
}
