// Fichas de la cocina de estrategias (26/11/2026, pedido del usuario): cómo funciona cada capa, con una imagen. Todas
// parten del mismo dibujo (un tramo que sube, una estrella fugaz arriba, unas velas quietas y una vela bajista con
// volumen) y cada ficha resalta su parte. Se despliegan con un clic en el «¿Cómo funciona?» de cada capa.
import React from 'react';

// Velas del dibujo: [apertura, cierre, máximo, mínimo]. Las mismas en todas las fichas
const STORY = [
  [10.0, 11.2, 11.5, 9.8], [11.2, 12.6, 12.9, 11.0], [12.6, 12.1, 13.0, 11.9], [12.1, 13.8, 14.1, 12.0], [13.8, 15.1, 15.4, 13.6],
  [15.1, 14.7, 15.6, 14.4], [14.7, 16.4, 16.7, 14.6], [16.4, 17.9, 18.2, 16.2], [17.9, 19.3, 19.6, 17.7], [19.3, 20.6, 20.9, 19.1],
  [20.6, 20.3, 23.2, 20.1], [20.3, 20.7, 21.0, 20.1], [20.7, 20.4, 20.9, 20.2], [20.4, 20.6, 20.8, 20.2], [20.6, 18.3, 20.7, 18.1],
  [18.3, 17.6, 18.5, 17.3], [17.6, 17.9, 18.1, 17.2], [17.9, 16.6, 18.0, 16.4]
];
const VOLUME = [3, 4, 3, 5, 5, 3, 5, 6, 6, 7, 9, 3, 2, 2, 12, 6, 4, 6];
const EMA = [9.6, 10.0, 10.4, 10.9, 11.5, 12.0, 12.6, 13.4, 14.2, 15.1, 15.9, 16.5, 17.0, 17.4, 17.6, 17.6, 17.6, 17.5];
const STAR = 10;   // La estrella fugaz
const DROP = 14;   // La vela bajista con volumen

const W = 320;
const LEFT = 14;
const STEP = 16;
const TOP = 38;
const HEIGHT = 96;
const LOW = 9;
const HIGH = 24;
const UP = '#089981';
const DOWN = '#F23645';
const INK = '#333333';
const BLUE = '#2962FF';
const ORANGE = '#F57C00';
const TEAL = '#00796B';   // La zona: el color de su fila bajo las velas y de sus franjas en el gráfico
const ZONE_LOW = 22.2;    // La resistencia del dibujo: la estrella fugaz la toca y cierra por debajo
const ZONE_HIGH = 23.5;

const x = (i) => LEFT + i * STEP + STEP / 2;
const y = (price) => TOP + ((HIGH - price) / (HIGH - LOW)) * HEIGHT;
const ROW_Y = TOP + HEIGHT + 22;   // Donde empiezan las filas bajo las velas

const Candles = ({ faded = [] }) => (
  <g>
    {STORY.map(([open, close, high, low], i) => {
      const color = close >= open ? UP : DOWN;
      const top = y(Math.max(open, close));
      return (
        <g key={i} opacity={faded.includes(i) ? 0.35 : 1}>
          <line x1={x(i)} x2={x(i)} y1={y(high)} y2={y(low)} stroke={color} strokeWidth="1.2" />
          <rect x={x(i) - 4.5} y={top} width="9" height={Math.max(1.5, y(Math.min(open, close)) - top)} fill={color} />
        </g>
      );
    })}
  </g>
);

const Volume = () => (
  <g>
    {VOLUME.map((v, i) => (
      <rect key={i} x={x(i) - 4.5} y={TOP + HEIGHT + 16 - v} width="9" height={v} fill={STORY[i][1] >= STORY[i][0] ? UP : DOWN} opacity="0.45" />
    ))}
  </g>
);

const Ema = () => (
  <g>
    <polyline fill="none" stroke={BLUE} strokeWidth="1.5" points={EMA.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
    <text x={x(17) - 2} y={y(EMA[17]) + 12} fontSize="9.5" fill={BLUE} textAnchor="end">EMA 50</text>
  </g>
);

/** Una fila bajo las velas, pintada en las velas [desde, hasta] */
const Row = ({ index, label, color, spans, soft = [] }) => (
  <g>
    <text x={W - 6} y={ROW_Y + index * 13 + 8} fontSize="9" fill="#555" textAnchor="end">{label}</text>
    {soft.map(([a, b], k) => <rect key={`s${k}`} x={x(a) - 7} y={ROW_Y + index * 13} width={(b - a) * STEP + 14} height="9" fill={color} opacity="0.3" />)}
    {spans.map(([a, b], k) => <rect key={k} x={x(a) - 7} y={ROW_Y + index * 13} width={(b - a) * STEP + 14} height="9" fill={color} opacity="0.85" />)}
  </g>
);

/** Un corchete sobre las velas [desde, hasta] con su rótulo */
const Bracket = ({ from, to, top, label, color }) => (
  <g>
    <path d={`M${x(from) - 8},${top + 6} V${top} H${x(to) + 8} V${top + 6}`} fill="none" stroke={color} strokeWidth="1.4" />
    <text x={(x(from) + x(to)) / 2} y={top - 4} fontSize="10" fill={color} textAnchor="middle" fontWeight="600">{label}</text>
  </g>
);

const Mark = ({ i, price, label, color = ORANGE, below = false }) => (
  <g>
    <rect x={x(i) - 9} y={y(price) + (below ? 4 : -15)} width="18" height="11" rx="2" fill="#fff" stroke={color} strokeWidth="1" />
    <text x={x(i)} y={y(price) + (below ? 12.5 : -6.5)} fontSize="8" fill={color} textAnchor="middle" fontWeight="700">{label}</text>
  </g>
);

const Signal = ({ i }) => (
  <g>
    <path d={`M${x(i) - 6},${TOP - 2} h12 l-6,9 z`} fill={INK} />
    <text x={x(i) + 9} y={TOP + 6} fontSize="10" fill={INK} fontWeight="600">Entra</text>
  </g>
);

const Frame = ({ rows = 0, children, label }) => (
  <svg className="kt-help-img" viewBox={`0 0 ${W} ${TOP + HEIGHT + 24 + rows * 13 + (rows ? 4 : 0)}`} role="img" aria-label={label}>
    <rect x="0.5" y="0.5" width={W - 1} height={TOP + HEIGHT + 23 + rows * 13 + (rows ? 4 : 0)} fill="#FFFFFF" stroke="#DEE2E6" />
    {children}
  </svg>
);

/** La zona del dibujo: una franja de precio desde la vela `from` hasta el borde derecho */
const ZoneBand = ({ from = 0, label = 'Resistencia', strong = false }) => (
  <g>
    <rect x={x(from) - 8} y={y(ZONE_HIGH)} width={W - LEFT - x(from) + 8} height={y(ZONE_LOW) - y(ZONE_HIGH)} fill={TEAL} opacity={strong ? 0.16 : 0.1}
      stroke={TEAL} strokeWidth="1" strokeDasharray="4 3" />
    <text x={x(from) - 3} y={y(ZONE_HIGH) + 10} fontSize="9.5" fill={TEAL} fontWeight="600">{label}</text>
  </g>
);

const scenes = {
  general: (
    <Frame rows={4} label="Una estrategia entera: el contexto, la zona, dos pasos del gatillo y la entrada">
      <rect x={x(3) - 8} y={TOP} width={(STAR - 3) * STEP + 16} height={HEIGHT} fill={BLUE} opacity="0.07" />
      <ZoneBand from={5} label="Zona" />
      <Ema />
      <Candles />
      <Volume />
      <text x={x(6)} y={TOP + 26} fontSize="10" fill={BLUE} textAnchor="middle" fontWeight="600">Contexto</text>
      <Bracket from={STAR} to={STAR} top={y(23.2) - 22} label="Paso 1" color={ORANGE} />
      <Bracket from={DROP} to={DROP} top={y(20.7) - 26} label="Paso 2" color={ORANGE} />
      <Signal i={DROP} />
      <Row index={0} label="contexto" color={BLUE} spans={[[3, STAR]]} />
      <Row index={1} label="zona" color={TEAL} spans={[[STAR, STAR]]} />
      <Row index={2} label="pasos" color={ORANGE} spans={[[STAR, STAR], [DROP, DROP]]} />
      <Row index={3} label="señal" color={INK} spans={[[DROP, DROP]]} />
    </Frame>
  ),
  contexto: (
    <Frame rows={1} label="El contexto: el precio viene subiendo y está lejos de la EMA durante varias velas">
      <rect x={x(3) - 8} y={TOP} width={(STAR - 3) * STEP + 16} height={HEIGHT} fill={BLUE} opacity="0.09" />
      <Ema />
      <Candles faded={[11, 12, 13, 14, 15, 16, 17]} />
      <line x1={x(9)} x2={x(9)} y1={y(20.4)} y2={y(15.3)} stroke={BLUE} strokeWidth="1.2" strokeDasharray="3 2" />
      <path d={`M${x(9) - 3},${y(20.4) + 5} L${x(9)},${y(20.4)} L${x(9) + 3},${y(20.4) + 5} M${x(9) - 3},${y(15.3) - 5} L${x(9)},${y(15.3)} L${x(9) + 3},${y(15.3) - 5}`} fill="none" stroke={BLUE} strokeWidth="1.2" />
      <text x={x(9) + 5} y={y(13.6)} fontSize="9.5" fill={BLUE}>↑ lejos de la EMA</text>
      <text x={x(5)} y={TOP + 12} fontSize="10" fill={BLUE} textAnchor="middle" fontWeight="600">se cumple vela tras vela</text>
      <Row index={0} label="contexto" color={BLUE} spans={[[3, STAR]]} />
    </Frame>
  ),
  zona: (
    <Frame rows={1} label="La zona: una resistencia a la que el precio llega; la vela la toca y cierra por debajo">
      <ZoneBand from={2} strong />
      <Candles faded={[13, 14, 15, 16, 17]} />
      <path d={`M${x(STAR)},${y(23.2) - 3} V10 h5`} fill="none" stroke={TEAL} strokeWidth="1.2" />
      <text x={x(STAR) + 8} y={13} fontSize="9.5" fill={TEAL}>el precio llega a la zona</text>
      <text x={x(STAR) + 8} y={25} fontSize="9.5" fill={TEAL}>y cierra fuera: rechazo</text>
      <Row index={0} label="zona" color={TEAL} spans={[[STAR, STAR]]} />
    </Frame>
  ),
  gatillo: (
    <Frame rows={2} label="El gatillo: dos pasos en orden y la entrada cuando se cumple el último">
      <Candles faded={[0, 1, 2, 3, 4, 5, 6]} />
      <Volume />
      <Bracket from={STAR} to={STAR} top={y(23.2) - 22} label="Paso 1" color={ORANGE} />
      <Mark i={STAR} price={23.2} label="HM" />
      <Bracket from={DROP} to={DROP} top={y(20.7) - 26} label="Paso 2" color={ORANGE} />
      <Mark i={DROP} price={18.1} label="VH" below />
      <path d={`M${x(STAR) + 12},${TOP + HEIGHT - 8} H${x(DROP) - 12}`} stroke={ORANGE} strokeWidth="1.2" strokeDasharray="3 2" />
      <path d={`M${x(DROP) - 17},${TOP + HEIGHT - 11} l5,3 l-5,3`} fill="none" stroke={ORANGE} strokeWidth="1.2" />
      <text x={(x(STAR) + x(DROP)) / 2} y={TOP + HEIGHT - 12} fontSize="9.5" fill={ORANGE} textAnchor="middle">después, hasta 7 velas</text>
      <Signal i={DROP} />
      <Row index={0} label="pasos" color={ORANGE} spans={[[STAR, STAR], [DROP, DROP]]} />
      <Row index={1} label="señal" color={INK} spans={[[DROP, DROP]]} soft={[[STAR + 1, DROP - 1]]} />
    </Frame>
  ),
  paso: (
    <Frame label="Un paso: dos cosas que ocurren juntas, dentro de pocas velas">
      <Candles faded={[0, 1, 2, 3, 4, 5, 13, 14, 15, 16, 17]} />
      <Volume />
      <rect x={x(8) - 8} y={TOP - 14} width={4 * STEP + 16} height={HEIGHT + 14} fill={ORANGE} opacity="0.08" stroke={ORANGE} strokeWidth="1" strokeDasharray="4 3" />
      <text x={LEFT} y={14} fontSize="10" fill={ORANGE} fontWeight="600">Un paso: «todos», en 5 velas</text>
      <Mark i={STAR} price={23.2} label="HM" />
      <Mark i={12} price={20.2} label="QA" below />
      <text x={x(10)} y={TOP + HEIGHT - 20} fontSize="9.5" fill="#8A4B00" textAnchor="middle">las dos marcas caen</text>
      <text x={x(10)} y={TOP + HEIGHT - 9} fontSize="9.5" fill="#8A4B00" textAnchor="middle">dentro de las 5 velas</text>
    </Frame>
  ),
  salida: (
    <Frame rows={1} label="La salida: al dar señal, una caja con la entrada, el stop detrás y el objetivo a dos veces el riesgo">
      <Candles faded={[0, 1, 2, 3, 4, 5, 6, 7, 8]} />
      <Signal i={DROP} />
      <rect x={x(15) - 8} y={y(21.0)} width={W - LEFT - x(15) + 8} height={y(18.3) - y(21.0)} fill={DOWN} opacity="0.16" />
      <rect x={x(15) - 8} y={y(18.3)} width={W - LEFT - x(15) + 8} height={y(12.9) - y(18.3)} fill={UP} opacity="0.16" />
      <line x1={x(15) - 8} x2={W - LEFT} y1={y(18.3)} y2={y(18.3)} stroke={INK} strokeWidth="1" />
      <text x={x(15) - 12} y={y(21.0) + 4} fontSize="9.5" fill={DOWN} textAnchor="end" fontWeight="600">stop</text>
      <text x={x(15) - 12} y={y(12.9) + 3} fontSize="9.5" fill={UP} textAnchor="end" fontWeight="600">objetivo · 2R</text>
      <text x={x(15) - 4} y={y(18.3) + 11} fontSize="9.5" fill={INK}>entrada</text>
      <text x={x(16)} y={y(19.6) + 3} fontSize="9" fill={DOWN} textAnchor="middle">1R</text>
      <Row index={0} label="señal" color={INK} spans={[[DROP, DROP]]} />
    </Frame>
  ),
  elegir: (
    <Frame label="Cómo se llena: un clic en una vela muestra lo que se cumple en ella">
      <rect x={x(STAR) - 8} y={TOP} width="16" height={HEIGHT + 18} fill={BLUE} opacity="0.1" stroke={BLUE} strokeWidth="1" strokeDasharray="4 3" />
      <Ema />
      <Candles />
      <Volume />
      <path d={`M${x(STAR) + 5},${y(21.6)} l0,13 l3.5,-3 l2.5,5.5 l2.2,-1 l-2.5,-5.5 l4.5,-0.5 z`} fill="#fff" stroke={INK} strokeWidth="1" />
      <rect x={x(12) + 2} y={TOP + 4} width="92" height="50" rx="3" fill="#fff" stroke="#ADB5BD" />
      <text x={x(12) + 8} y={TOP + 16} fontSize="9" fill={INK} fontWeight="700">En esta vela</text>
      <rect x={x(12) + 8} y={TOP + 22} width="62" height="10" rx="5" fill={BLUE} opacity="0.18" />
      <text x={x(12) + 12} y={TOP + 30} fontSize="8" fill={BLUE}>Lejos de la EMA</text>
      <rect x={x(12) + 8} y={TOP + 36} width="54" height="10" rx="2" fill={ORANGE} opacity="0.2" />
      <text x={x(12) + 12} y={TOP + 44} fontSize="8" fill="#B25A00">Estrella fugaz</text>
      <text x={x(12) + 88} y={TOP + 31} fontSize="10" fill={BLUE} textAnchor="end" fontWeight="700">+</text>
      <text x={x(12) + 88} y={TOP + 45} fontSize="10" fill={ORANGE} textAnchor="end" fontWeight="700">+</text>
    </Frame>
  )
};

export const HELP = {
  general: {
    title: 'Cómo se arma una estrategia',
    text: [
      'Una estrategia tiene capas. El contexto (azul) es el escenario: lo que ya venía pasando. La zona (verde) es dónde: un área de precio a la que el precio tiene que llegar. El gatillo (naranja) es lo que tiene que ocurrir, por pasos y en orden.',
      'Cuando se cumple el último paso, la estrategia da su señal (el triángulo negro). Bajo las velas, cada capa tiene su fila, pintada donde se cumple.'
    ]
  },
  elegir: {
    title: 'Cómo se llena',
    text: [
      'Reproduce, pausa donde veas algo y haz clic en esa vela. La cocina lista lo que se cumple ahí: las zonas cercanas, los estados vigentes y los eventos de esa vela.',
      'Cada uno tiene su botón para sumarlo al contexto, a la zona o a un paso. Lo de una misma vela va al mismo paso; lo de una vela posterior, a un paso después.'
    ]
  },
  contexto: {
    title: 'Capa 1 · Contexto',
    text: [
      'Lo que ya venía pasando. Son estados: se cumplen o no en cada vela, y suelen durar muchas velas seguidas (el precio lejos de una EMA, un tramo fuerte, el Alligator despierto).',
      'El contexto no dispara nada: solo deja pasar al gatillo. Se mira mientras se junta el paso 1, o en la señal si lo cambias. Un evento que traigas aquí cuenta «si ocurrió en las últimas N velas».'
    ]
  },
  zona: {
    title: 'Capa 2 · Zona',
    text: [
      'Dónde tiene que estar el precio: un área que dura. Puede ser un soporte o una resistencia, un FVG abierto, un order block, una zona de liquidaciones, o algo que pongas tú: un rectángulo o una línea horizontal dibujados, o un nivel de un perfil de volumen de rango fijo (su POC, su VAH, su VAL o su área de valor). Se elige en el gráfico: un clic en la zona, o en la vela donde el precio la toca, la lista con sus botones.',
      'Se suma de dos maneras. «Todas»: todas las de ese tipo; es una regla, vale en cualquier fecha y después se puede probar. «Solo esta»: esa franja fija, para seguirla en la simulación manual. Una zona cuenta desde que se conoce y hasta que deja de valer (un cierre más allá la rompe; un FVG termina al llenarse). Lo que pones tú (un dibujo, un nivel de un VP fijo) es siempre una zona fija, y cuenta desde que lo sumas.',
      'La capa pide que el precio se acerque a la zona o la toque, mirado mientras se junta el paso 1 o en la señal. Y deja dos eventos para los pasos: «el precio llega a la zona» y «rechazo en la zona» (la toca y cierra fuera, del lado del trade).'
    ]
  },
  gatillo: {
    title: 'Capa 3 · Gatillo',
    text: [
      'Lo que tiene que pasar. Va por pasos, en orden: primero el 1, después el 2. Entre dos pasos hay un plazo («después, hasta 7 velas»): si el paso 2 llega más tarde, no cuenta.',
      'La señal sale en la vela en que se cumple el último paso. En la fila «Señal», el gris es «a punto»: ya se cumplió el penúltimo paso y sigue a tiempo.'
    ]
  },
  salida: {
    title: 'Capa 4 · Salida y orden',
    text: [
      'Lo que pasa cuando la estrategia da señal. Al cerrar la vela de la señal se arma una caja TP/SL: la entrada al precio de ese momento (la apertura de la vela que sigue), el stop detrás y el objetivo a tantas veces el riesgo (R).',
      'El stop sale de donde elijas: a una distancia en ATR de la entrada, detrás de la vela de la señal, o en el borde lejano de la zona, si la estrategia tiene capa de zona. El tamaño va por riesgo (lo que pierdes si toca el stop) o por monto fijo, como en el panel de trading.',
      '«Preguntar»: la caja queda propuesta y tú decides si abrir la orden; puedes moverla antes. «Automática»: la orden se abre sola. De las dos maneras la orden es como cualquier orden manual: va al historial, a las imágenes y al Observador, marcada con el nombre y la versión de la estrategia. Va una posición a la vez: con una abierta, la señal solo avisa. Solo con esta pestaña abierta.'
    ]
  },
  paso: {
    title: 'Qué es un paso',
    text: [
      'Un paso es un momento del escenario: lo que tiene que ocurrir junto, en pocas velas. Dentro del paso no importa el orden.',
      'Tú eliges cuánto pide: «todos», «al menos N» o «cualquiera», y en cuántas velas tienen que juntarse. El paso se completa en la vela de uno de sus eventos; un estado dentro de un paso tiene que cumplirse en esas velas.'
    ]
  }
};

/** El botón que despliega una ficha */
export const HelpToggle = ({ open, onClick, label = '¿Cómo funciona?' }) => (
  <button type="button" className={`kt-help-toggle${open ? ' open' : ''}`} onClick={onClick} aria-expanded={open}>
    {open ? 'Cerrar' : label}
  </button>
);

/** Una ficha desplegada: su imagen y su texto */
export const HelpCard = ({ id }) => {
  const item = HELP[id];
  if (!item) return null;
  return (
    <div className="kt-help-card">
      <div className="kt-help-title">{item.title}</div>
      {scenes[id]}
      {item.text.map((line, i) => <p key={i}>{line}</p>)}
    </div>
  );
};
