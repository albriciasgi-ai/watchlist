/**
 * Nombres cortos de los elementos del probador, para la pantalla (pedido del usuario: las iniciales costaban).
 * El código sigue siendo el identificador de la regla guardada y del backend: aquí solo cambia lo que se lee.
 * El nombre largo del backend (a veces el del libro, en inglés) va en el título al pasar el mouse.
 */
export const ELEMENT_LABELS = {
  // Elementos OF (Orderflows Unlocked)
  VA: 'Área de valor abandonada', OG: 'Hueco entre áreas de valor', AP: 'POC alineado', SL: 'POC tirachinas',
  RL: 'Absorción en un nivel', EX: 'Agotamiento en el extremo', ZP: 'Cero en el extremo', DT: 'Cola de delta',
  RS: 'Pasivo que se retira', DD: 'Divergencia de delta', PD: 'Divergencia de precio', IV: 'Desequilibrio inverso',
  AD: 'Acumulación o distribución', SW: 'Barrido de niveles', VL: 'Liquidez vertical', SQ: 'Secuencia creciente',
  DB: 'Ruptura de delta', PW: 'Onda de POC', DV: 'Delta/volumen extremo', ST: 'Desequilibrios apilados',
  VI: 'Varios desequilibrios', IR: 'Desequilibrio de giro', RD: 'Desequilibrio repetido', VD: 'Volumen decreciente',
  TP: 'Nivel casi vacío', OP: 'POC fuera de rango', RX: 'Ratio de extremos', XD: 'Delta extremo',
  SM: 'Delta contrario pequeño', BR: 'Barrido real', GR: 'Orden grande',
  AB: 'Absorción en el libro', BL: 'Barrido del libro', LD: 'Libro delgado',
  // Elementos del probador
  LIQ: 'Barrido de liquidaciones', VH: 'Volumen alto', VR: 'Regreso al valor', VF: 'Fallo fuera del valor',
  VX: 'Aceptación fuera del valor', VE: 'Borde del valor', CC: 'Cambio de carácter', HM: 'Martillo o estrella',
  EN: 'Envolvente', DJ: 'Doji', RF: 'Flecha de volumen', RB: 'Rombo de volumen', GC: 'Canal gaussiano',
  BX: 'Ruptura de caja', BE: 'Borde de caja', CP: 'Compresión', FV: 'FVG nuevo', SP: 'Swing', IM: 'Impulso',
  // Bill Williams (los tres sabios) y estructura SMC (20/11)
  WD: 'Barra divergente', WA: 'AO tres barras', WF: 'Ruptura de fractal',
  BS: 'Ruptura de estructura', OB: 'Order block', BK: 'Breaker', EQ: 'Barrido de iguales',
  // Lector VPA de Coulling (21/11)
  QA: 'Esfuerzo sin resultado', QB: 'Ruptura con volumen', QF: 'Ruptura sin volumen', QR: 'Retroceso sin volumen',
  QT: 'Prueba de poco volumen', QS: 'Frenado o techo', QC: 'Clímax de volumen', QE: 'Medidor VPA',
  QV: 'Esfuerzo con resultado', QG: 'Giro del medidor',  // Motor 7 (24/11, galería 2)
  // Byko, de Bikotrading (21/11)
  FB: 'Falso rompimiento', BA: 'Ruptura tras acumulación', TA: 'Trampa de absorción', PO: 'Purga de OI',
  // Trader Dale: la zona y el primer regreso (21/11)
  DS: 'Apilados con regreso', DN: 'Nodo doble con regreso', DG: 'Orden grande con regreso', DA: 'Acumulación con regreso',
  DC: 'Cluster del tramo con regreso',
  // Hipótesis del 22/11: el control de DS como regla
  DX: 'Apilados desplazados con regreso'
};

/** Nombre corto de un código; sin nombre conocido, el código o el nombre que se pase. */
export const elementLabel = (code, fallback) => ELEMENT_LABELS[code] || fallback || code;

/** Varios códigos (lista, o texto con + o |) como nombres. */
export function elementLabels(codes, sep = ' + ') {
  const list = Array.isArray(codes) ? codes : String(codes || '').split('+');
  return list.filter(Boolean).map(item => String(item).split('|').map(code => elementLabel(code.trim())).join(' o ')).join(sep);
}
