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
  { id: 'williams', name: 'Williams' }
];

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
    help: 'El medidor del Lector VPA suma más fuerza que debilidad de ese lado.' }
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
    id: code, code, kind: EVENT, fam: item.fam, name, shown: item.shown, sided,
    p: { ...(item.p || {}), ...(sided ? { dir: 'favor' } : {}) }, fields: item.fields,
    text: SPECIAL[code] || ((p, side) => (sided ? name + word(p, side, ', alcista', ', bajista', ', a favor', ', en contra') : name)),
    help: 'Elemento del backtesting global de App 1, detectado con las mismas reglas y sus valores de fábrica.'
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
