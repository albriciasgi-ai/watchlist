// Los bloques de la cocina de estrategias (26/11/2026): nombre, texto según el lado del trade, ayuda y lo que se puede
// cambiar en cada uno. El cálculo está en backend/kitchen.py, sobre los detectores del probador de reglas;
// backend/tests/test_kitchen.py vigila que las dos listas conozcan los mismos bloques.
import { elementLabel } from '../backtesting/elementLabels.js';

export const STATE = 'estado';   // Se cumple o no en cada vela
export const EVENT = 'evento';   // Ocurre en una vela

export const BLOCK_FAMILIES = [
  { id: 'lineas', name: 'Líneas: EMA y Alligator' },
  { id: 'tramo', name: 'Lo que venía pasando' },
  { id: 'velas', name: 'Velas y volumen' },
  { id: 'vpa', name: 'Lector VPA' },
  { id: 'estructura', name: 'Estructura' },
  { id: 'williams', name: 'Williams' },
  { id: 'zonas', name: 'Zonas: lo que hace el precio en la capa de zona' },
  { id: 'of', name: 'Order flow, con trades reales' }
];

// Zonas que el motor detecta (kitchen.py, ZONE_KINDS): soportes y resistencias, FVG abiertos, order blocks y zonas de
// liquidaciones
export const ZONE_KINDS = ['sr', 'fvg', 'ob', 'liq'];
// Lo que el usuario pone en el gráfico y solo conoce la página (kitchen.py, USER_KINDS): un dibujo o un nivel de un
// perfil de volumen de rango fijo. Entran siempre como zona fija
export const USER_ZONE_KINDS = ['draw', 'vp'];
// Lo que ofrece un perfil de rango fijo (VP Fixed Range): sus tres niveles y su área de valor, del VAL al VAH
export const VP_PARTS = { poc: 'POC', vah: 'VAH', val: 'VAL', va: 'Área de valor' };
// Estados que salen del almacén de trades (kitchen.py, FLOW_STATE_IDS)
export const FLOW_STATES = ['delta', 'cvd'];
// Elementos OF (of_elements.py): eventos con trades reales, solo en las monedas con almacén
const OF_ELEMENTS = [
  'VA', 'OG', 'AP', 'SL', 'RL', 'EX', 'ZP', 'DT', 'RS', 'DD', 'PD', 'IV', 'AD', 'SW', 'VL', 'SQ', 'DB', 'PW', 'DV',
  'ST', 'VI', 'IR', 'RD', 'VD', 'TP', 'OP', 'RX', 'XD', 'SM', 'BR', 'GR'
];

// Cada tipo de zona: cómo se llama una (según su lado: 1 alcista, −1 bajista), cómo se llaman todas y qué indicador de
// App 1 las dibuja
export const ZONE_TYPES = {
  sr: { one: (way) => (way > 0 ? 'Soporte' : 'Resistencia'), all: 'Soportes y resistencias', up: 'Soportes', down: 'Resistencias', shown: 'S&R v2',
    help: 'Los swings que el precio no ha superado, cada uno como la línea que dibuja el indicador: el promedio de sus toques. Un nivel termina cuando una vela cierra más allá de todos sus toques.' },
  fvg: { one: (way) => `FVG ${way > 0 ? 'alcista' : 'bajista'}`, all: 'FVG abiertos', up: 'FVG abiertos alcistas', down: 'FVG abiertos bajistas', shown: 'FVG',
    help: 'Huecos de tres velas que el precio todavía no llenó. Cada vela que entra en uno lo recorta; lleno, termina.' },
  ob: { one: (way) => `Order block ${way > 0 ? 'alcista' : 'bajista'}`, all: 'Order blocks', up: 'Order blocks alcistas', down: 'Order blocks bajistas', shown: 'Estructura SMC',
    help: 'La vela que deja cada ruptura de estructura. Termina cuando una vela cierra más allá de su borde lejano.' },
  liq: { one: () => 'Zona de liquidaciones', all: 'Zonas de liquidaciones', up: 'Zonas de liquidaciones', down: 'Zonas de liquidaciones', shown: 'Liquidaciones',
    help: 'Precios donde se liquidó mucho dinero en los últimos 30 días, cerca del precio. Cuenta mientras el indicador la muestra.' },
  draw: { one: () => 'Zona dibujada', all: 'Zonas dibujadas', up: 'Zonas dibujadas', down: 'Zonas dibujadas', shown: null,
    help: 'Un rectángulo o una línea horizontal que dibujaste. Cuenta desde que lo sumaste a la estrategia: no se mira hacia atrás.' },
  vp: { one: (way, zone) => `${VP_PARTS[zone?.shape] || 'Nivel'} del VP fijo`, all: 'Niveles de VP fijo', up: 'Niveles de VP fijo', down: 'Niveles de VP fijo', shown: null,
    help: 'Un nivel de un perfil de volumen de rango fijo (VP Fixed Range) del gráfico: su POC, su VAH, su VAL o su área de valor, del VAL al VAH. Cuenta desde que lo sumaste a la estrategia, con el precio que tenía entonces: no se mira hacia atrás.' }
};

/** "Resistencia", "FVG alcista", "POC del VP fijo": una zona por su nombre */
export const zoneName = (zone) => (ZONE_TYPES[zone?.kind] || ZONE_TYPES.draw).one(zone?.way || 0, zone);

// Una sigla (FVG, POC) se queda como está
const lowerFirst = (text) => (/^[A-ZÁÉÍÓÚÑ]{2}/.test(text) ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`);

/**
 * Una zona elegida en palabras, para una estrategia de ese lado. «Todas las de este tipo» dice el tipo con su sentido
 * (con un lado fijo, alcistas o bajistas; con los dos en espejo, a favor o en contra). «Solo esta» dice cuál: `range` es
 * su precio ya escrito (con fecha oculta va como índice).
 */
export function pickText(pick, side, range = '') {
  const type = ZONE_TYPES[pick?.kind];
  if (!type) return '';
  if (pick.type === 'one') {
    const name = pick.kind === 'draw' ? (pick.lo === pick.hi ? 'Línea dibujada' : 'Zona dibujada') : zoneName(pick);
    return `Solo esta: ${lowerFirst(name)}${range ? ` ${range}` : ''}`;
  }
  if (pick.kind === 'liq' || (pick.dir !== 'favor' && pick.dir !== 'contra')) return type.all;
  if (side === 'both') return `${type.all}, ${pick.dir === 'contra' ? 'en contra' : 'a favor'}`;
  return ((side === 'long') === (pick.dir !== 'contra')) ? type.up : type.down;
}

// Las líneas que un bloque puede mirar. Una EMA de otro periodo se escribe "e<periodo>"
export const LINE_OPTIONS = [
  ['e9', 'EMA 9'], ['e20', 'EMA 20'], ['e50', 'EMA 50'], ['e100', 'EMA 100'], ['e200', 'EMA 200'],
  ['lips', 'Labios del Alligator'], ['teeth', 'Dientes del Alligator'], ['jaw', 'Mandíbula del Alligator']
];
const ALLIGATOR = { lips: 'los labios', teeth: 'los dientes', jaw: 'la mandíbula' };

/** "la EMA 50", "los dientes": una línea dentro de una frase */
export const lineName = (line) => ALLIGATOR[line] || `la EMA ${String(line || '').slice(1)}`;
/** "EMA 50", "Dientes": una línea como rótulo del gráfico */
export const lineLabel = (line) => (ALLIGATOR[line] ? { lips: 'Labios', teeth: 'Dientes', jaw: 'Mandíbula' }[line] : `EMA ${String(line || '').slice(1)}`);

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '–';
};

/** La palabra según el lado: con un lado fijo se dice alcista o bajista; con los dos en espejo, a favor o en contra */
function word(p, side, up, down, favor, against) {
  const withTrade = p.dir !== 'contra';
  if (side === 'both') return withTrade ? favor : against;
  return ((side === 'long') === withTrade) ? up : down;
}

// Estados y eventos de las líneas, con su texto. `sided`: tiene lado (a favor o en contra del trade).
// lines: selectores de línea [campo, rótulo]. fields: números [campo, rótulo, mínimo, máximo, paso]
const BLOCKS = [
  { id: 'side', kind: STATE, fam: 'lineas', name: 'El cierre, de un lado de una línea', p: { line: 'e50', dir: 'favor' }, sided: true,
    lines: [['line', 'Línea']],
    text: (p, side) => word(p, side, 'Cierra por encima de ', 'Cierra por debajo de ', 'Cierra del lado a favor de ', 'Cierra del lado en contra de ') + lineName(p.line),
    help: 'El cierre de la vela queda de ese lado de la línea.' },
  { id: 'lejos', kind: STATE, fam: 'lineas', name: 'El precio, lejos de una línea', p: { line: 'e50', atr: 2, dir: 'contra' }, sided: true,
    lines: [['line', 'Línea']], fields: [['atr', 'Distancia mínima (ATR)', 0.5, 8, 0.5]],
    text: (p, side) => `Está a más de ${num(p.atr)} ATR ${word(p, side, 'por encima de ', 'por debajo de ', 'del lado a favor de ', 'del lado en contra de ')}${lineName(p.line)}`,
    help: 'El cierre se estiró lejos de la línea, medido en ATR.' },
  { id: 'order', kind: STATE, fam: 'lineas', name: 'EMA ordenadas', p: { dir: 'favor' }, sided: true,
    text: (p, side) => `EMA 20, 50 y 200 ordenadas ${word(p, side, 'al alza', 'a la baja', 'a favor', 'en contra')}`,
    help: 'La EMA 20 sobre la 50 y la 50 sobre la 200, o al revés.' },
  { id: 'awake', kind: STATE, fam: 'lineas', name: 'Alligator despierto', p: { dir: 'favor' }, sided: true,
    text: (p, side) => `Alligator despierto ${word(p, side, 'al alza', 'a la baja', 'a favor', 'en contra')}`,
    help: 'Labios, dientes y mandíbula ordenados y separados.' },
  { id: 'sleep', kind: STATE, fam: 'lineas', name: 'Alligator dormido', p: {}, sided: false,
    text: () => 'Alligator dormido',
    help: 'Las tres líneas del Alligator están juntas o entrelazadas.' },
  { id: 'cross', kind: EVENT, fam: 'lineas', name: 'El precio cruza una línea', p: { line: 'e20', dir: 'favor' }, sided: true,
    lines: [['line', 'Línea']],
    text: (p, side) => `El precio cruza ${lineName(p.line)}${word(p, side, ' hacia arriba', ' hacia abajo', ', a favor', ', en contra')}`,
    help: 'El cierre pasa al otro lado de la línea.' },
  { id: 'bounce', kind: EVENT, fam: 'lineas', name: 'El precio rebota en una línea', p: { line: 'e50', dir: 'favor' }, sided: true,
    lines: [['line', 'Línea']],
    text: (p, side) => `El precio rebota en ${lineName(p.line)}${word(p, side, ' hacia arriba', ' hacia abajo', ', a favor', ', en contra')}`,
    help: 'La vela toca la línea y cierra de vuelta del lado en que venía.' },
  { id: 'xline', kind: EVENT, fam: 'lineas', name: 'Dos líneas se cruzan', p: { a: 'e20', b: 'e50', dir: 'favor' }, sided: true,
    lines: [['a', 'Línea que cruza'], ['b', 'Línea cruzada']],
    text: (p, side) => {
      const first = lineName(p.a);
      const plural = p.a === 'lips' || p.a === 'teeth';
      return `${first.charAt(0).toUpperCase()}${first.slice(1)}${plural ? ' cruzan ' : ' cruza '}${lineName(p.b)}${word(p, side, ' hacia arriba', ' hacia abajo', ', a favor', ', en contra')}`;
    },
    help: 'Una línea pasa al otro lado de la otra.' },
  { id: 'tramo', kind: STATE, fam: 'tramo', name: 'Viene de un tramo fuerte', p: { atr: 4, n: 24, dir: 'contra' }, sided: true,
    fields: [['atr', 'Avance mínimo (ATR)', 1, 12, 0.5], ['n', 'En cuántas velas', 3, 60, 1]],
    text: (p, side) => `${word(p, side, 'Viene de subir ', 'Viene de caer ', 'Viene de un tramo a favor de ', 'Viene de un tramo en contra de ')}${num(p.atr)} ATR en ${num(p.n)} velas`,
    help: 'El cierre avanzó mucho en pocas velas, medido en ATR.' },
  { id: 'pausa', kind: STATE, fam: 'tramo', name: 'El precio se queda quieto', p: { n: 3, atr: 1 }, sided: false,
    fields: [['n', 'Velas', 2, 20, 1], ['atr', 'Rango máximo (ATR)', 0.2, 5, 0.1]],
    text: (p) => `El precio se queda quieto: ${num(p.n)} velas en ${num(p.atr)} ATR`,
    help: 'Varias velas seguidas caben en un rango chico.' },
  { id: 'vpam', kind: STATE, fam: 'vpa', name: 'Medidor VPA de un lado', p: { u: 0.3, dir: 'favor' }, sided: true,
    fields: [['u', 'Umbral del medidor', 0.1, 3, 0.1]],
    text: (p, side) => `Medidor VPA ${word(p, side, 'alcista', 'bajista', 'a favor', 'en contra')}`,
    help: 'El medidor del Lector VPA suma más fuerza que debilidad de ese lado.' },
  // Con trades reales (`flow`): solo en las monedas con almacén de trades
  { id: 'delta', kind: STATE, fam: 'of', name: 'Delta de la vela', p: { dir: 'favor' }, sided: true, flow: true, shown: 'Delta de volumen',
    text: (p, side) => `Delta de la vela ${word(p, side, 'comprador', 'vendedor', 'a favor', 'en contra')}`,
    help: 'En la vela pesó más la compra agresiva o la venta agresiva. Con trades reales.' },
  { id: 'cvd', kind: STATE, fam: 'of', name: 'CVD de varias velas', p: { n: 20, dir: 'favor' }, sided: true, flow: true, shown: 'CVD',
    fields: [['n', 'Velas', 2, 100, 1]],
    text: (p, side) => `CVD de ${num(p.n)} velas ${word(p, side, 'al alza', 'a la baja', 'a favor', 'en contra')}`,
    help: 'El delta sumado de las últimas velas, con la de la señal, va de ese lado. Es el filtro de CVD del backtesting global, con trades reales.' },
  // De la capa de zona (`zone`): hablan de las zonas elegidas en ella. Sin lado propio: el rechazo mira el lado del trade
  { id: 'ztoca', kind: EVENT, fam: 'zonas', name: 'El precio llega a la zona', p: {}, sided: false, zone: true,
    text: () => 'El precio llega a la zona',
    help: 'La primera vela que toca una de las zonas de la capa de zona: la anterior, con la zona ya a la vista, no la tocaba.' },
  { id: 'zrech', kind: EVENT, fam: 'zonas', name: 'Rechazo en la zona', p: {}, sided: false, zone: true,
    text: () => 'Rechazo en la zona',
    help: 'Una vela toca una de las zonas de la capa de zona y cierra fuera de ella, del lado del trade: por debajo en un corto, por encima en un largo.' }
];

// Eventos del probador de reglas: familia, indicador de App 1 que lo dibuja y campos que la cocina deja cambiar.
// Su nombre es el del backtesting global (elementLabels.js) y se detectan con sus valores de fábrica
const ELEMENTS = {
  HM: { fam: 'velas', shown: 'Rejection Patterns' },
  EN: { fam: 'velas', shown: 'Rejection Patterns' },
  DJ: { fam: 'velas', shown: 'Rejection Patterns' },
  VH: { fam: 'velas', shown: null },
  FV: { fam: 'velas', shown: 'FVG', p: { minAtr: 0.3 }, fields: [['minAtr', 'Hueco mínimo (ATR)', 0, 5, 0.1]] },
  IM: { fam: 'velas', shown: null, p: { bars: 3, atr: 2 }, fields: [['atr', 'Avance mínimo (ATR)', 0.2, 20, 0.1], ['bars', 'En cuántas velas', 1, 50, 1]] },
  SP: { fam: 'estructura', shown: 'Swing', p: { bars: 5 }, fields: [['bars', 'Velas a cada lado', 2, 20, 1]] },
  CC: { fam: 'estructura', shown: null },
  BX: { fam: 'estructura', shown: 'Rangos horizontales' },
  BE: { fam: 'estructura', shown: 'Rangos horizontales' },
  CP: { fam: 'estructura', shown: 'Rangos horizontales', sided: false },
  RF: { fam: 'velas', shown: 'Volumen de Respuesta' },
  RB: { fam: 'velas', shown: 'Volumen de Respuesta' },
  GC: { fam: 'lineas', shown: null },
  QA: { fam: 'vpa', shown: 'Lector VPA' },
  QV: { fam: 'vpa', shown: 'Lector VPA' },
  QB: { fam: 'vpa', shown: 'Lector VPA' },
  QF: { fam: 'vpa', shown: 'Lector VPA' },
  QR: { fam: 'vpa', shown: 'Lector VPA' },
  QT: { fam: 'vpa', shown: 'Lector VPA' },
  QS: { fam: 'vpa', shown: 'Lector VPA' },
  QC: { fam: 'vpa', shown: 'Lector VPA' },
  QE: { fam: 'vpa', shown: 'Lector VPA' },
  QG: { fam: 'vpa', shown: 'Lector VPA' },
  WD: { fam: 'williams', shown: 'Tres sabios' },
  WA: { fam: 'williams', shown: 'Tres sabios' },
  WF: { fam: 'williams', shown: 'Tres sabios' },
  BS: { fam: 'estructura', shown: 'Estructura SMC' },
  OB: { fam: 'estructura', shown: 'Estructura SMC' },
  BK: { fam: 'estructura', shown: 'Estructura SMC' },
  EQ: { fam: 'estructura', shown: 'Estructura SMC' }
};
for (const code of OF_ELEMENTS) ELEMENTS[code] = { fam: 'of', shown: 'Elementos OF', flow: true };

// Los que se leen mejor con sus propias palabras
const SPECIAL = {
  HM: (p, side) => word(p, side, 'Martillo', 'Estrella fugaz', 'Martillo o estrella, a favor', 'Martillo o estrella, en contra'),
  EN: (p, side) => `Envolvente${word(p, side, ' alcista', ' bajista', ', a favor', ', en contra')}`,
  VH: (p, side) => word(p, side, 'Vela alcista con volumen alto', 'Vela bajista con volumen alto', 'Vela con volumen alto, a favor', 'Vela con volumen alto, en contra'),
  FV: (p, side) => `FVG nuevo${word(p, side, ' alcista', ' bajista', ', a favor', ', en contra')}`,
  IM: (p, side) => `Impulso${word(p, side, ' al alza', ' a la baja', ', a favor', ', en contra')}`,
  QE: (p, side) => `El medidor VPA cruza su umbral${word(p, side, ' hacia arriba', ' hacia abajo', ', a favor', ', en contra')}`,
  QG: (p, side) => `El medidor VPA gira${word(p, side, ' al alza', ' a la baja', ', a favor', ', en contra')}`,
  CP: () => 'Compresión: se forma una caja'
};

for (const [code, item] of Object.entries(ELEMENTS)) {
  const name = elementLabel(code);
  const sided = item.sided !== false;
  BLOCKS.push({
    id: code, code, kind: EVENT, fam: item.fam, name, shown: item.shown, sided, flow: !!item.flow,
    p: { ...(item.p || {}), ...(sided ? { dir: 'favor' } : {}) }, fields: item.fields,
    text: SPECIAL[code] || ((p, side) => (sided ? name + word(p, side, ', alcista', ', bajista', ', a favor', ', en contra') : name)),
    help: item.flow
      ? 'Elemento de order flow del backtesting global, detectado en los trades reales con sus valores de fábrica. Solo en las monedas con almacén de trades.'
      : 'Elemento del backtesting global de App 1, detectado con las mismas reglas y sus valores de fábrica.'
  });
}

const BY_ID = Object.fromEntries(BLOCKS.map(def => [def.id, def]));

export const allBlocks = () => BLOCKS;
export const blockDef = (id) => BY_ID[id] || null;
export const isState = (block) => blockDef(block?.id)?.kind === STATE;

/** Un bloque nuevo de esa clase, con sus valores de fábrica y lo que se le cambie */
export function protoOf(id, p = {}) {
  const def = blockDef(id);
  if (!def) return null;
  return { id, p: { ...def.p, ...p } };
}

/** El bloque en palabras, para una estrategia de ese lado ('long', 'short' o 'both') */
export function blockText(block, side) {
  const def = blockDef(block?.id);
  if (!def) return block?.id || '';
  const text = def.text(block.p || {}, side);
  if (block.conv === 'recent') return `${text}, en las últimas ${num(block.cn ?? 5)} velas`;
  if (block.conv === 'during') return `Se cumple: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  return text;
}

/** La clase con que cuenta en su capa: un evento en el contexto cuenta como estado ("ocurrió hace poco") */
export const kindIn = (block) => (block?.conv === 'recent' ? STATE : blockDef(block?.id)?.kind || EVENT);
