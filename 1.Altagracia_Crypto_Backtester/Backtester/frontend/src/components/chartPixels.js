// Nitidez del lienzo del gráfico.
//
// MiniChart dibuja en píxeles CSS con una escala igual a los píxeles reales de la pantalla
// (devicePixelRatio). Este módulo lleva rectángulos y líneas a píxeles reales enteros: sin eso,
// un borde que cae entre dos píxeles se pinta a medio tono en los dos y se ve borroso.
//
// - fillRect y strokeRect del lienzo del gráfico se ajustan solos (installCrispRects)
// - las líneas horizontales y verticales usan alignX, alignY y crispWidth al dibujarse
// - "chart_pixel_ratio" en localStorage: "off" vuelve al dibujo anterior, un número fija la densidad

const state = { rx: 1, ry: 1, on: false };
const proto = typeof CanvasRenderingContext2D !== 'undefined' ? CanvasRenderingContext2D.prototype : null;

/** MiniChart lo llama al empezar cada cuadro, con la escala real del lienzo en cada eje */
export function setCanvasPixels(rx, ry, on = true) {
  state.rx = rx > 0 && Number.isFinite(rx) ? rx : 1;
  state.ry = ry > 0 && Number.isFinite(ry) ? ry : 1;
  state.on = Boolean(on);
}

/** Píxeles reales por píxel CSS en el cuadro que se está dibujando */
export const pixelRatio = () => (state.on ? state.rx : 1);

/** true si el cuadro en curso se alinea a píxeles reales (false con "chart_pixel_ratio" en "off") */
export const crispEnabled = () => state.on;

/**
 * Densidad con que se dibuja: la de la pantalla, salvo que localStorage diga otra cosa.
 * Devuelve null con "off": el lienzo se dibuja como antes de esta mejora.
 */
export function screenDensity() {
  let forced = null;
  try { forced = window.localStorage?.getItem('chart_pixel_ratio'); } catch { forced = null; }
  if (forced === 'off') return null;
  const value = Number(forced);
  if (forced && Number.isFinite(value) && value >= 0.5 && value <= 4) return value;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  return dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
}

const ratioFor = axis => (axis === 'x' ? state.rx : state.ry);
// Sin grosor válido cuenta como 1, el valor por defecto del lienzo
const deviceWidth = (width, ratio) => Math.max(1, Math.round((width > 0 ? width : 1) * ratio));

/** Grosor en CSS que da un número entero de píxeles reales, nunca menos de uno */
export function crispWidth(width = 1, axis = 'y') {
  if (!state.on || !(width > 0)) return width;
  const ratio = ratioFor(axis);
  return deviceWidth(width, ratio) / ratio;
}

/** Centro de una línea para que su grosor caiga entero en píxeles reales */
export function alignLine(value, width = 1, axis = 'y') {
  if (!state.on || !Number.isFinite(value)) return value;
  const ratio = ratioFor(axis);
  const device = deviceWidth(width, ratio);
  return (Math.round(value * ratio - device / 2) + device / 2) / ratio;
}

/** Línea vertical: su x */
export const alignX = (x, width = 1) => alignLine(x, width, 'x');
/** Línea horizontal: su y */
export const alignY = (y, width = 1) => alignLine(y, width, 'y');

/** Centro del borde que strokeRect pinta en esa orilla, para dibujar otra línea encima */
export function rectEdge(value, width = 1, axis = 'y') {
  if (!state.on || !Number.isFinite(value)) return value;
  const ratio = ratioFor(axis);
  const device = deviceWidth(width, ratio);
  const pixel = Math.round(value * ratio);
  return (device % 2 === 0 ? pixel : pixel - 0.5) / ratio;
}

/** Borde de píxel real más cercano, para rellenos que se tocan */
export function snapEdge(value, axis = 'y') {
  if (!state.on || !Number.isFinite(value)) return value;
  const ratio = ratioFor(axis);
  return Math.round(value * ratio) / ratio;
}

/** Tramo vertical [top, bottom] en píxeles reales enteros, de al menos un píxel: [y, alto] */
export function snapSpanY(top, bottom) {
  const low = Math.min(top, bottom);
  const high = Math.max(top, bottom);
  if (!state.on) return [low, high - low];
  const r = state.ry;
  const a = Math.round(low * r);
  const b = Math.max(a + 1, Math.round(high * r));
  return [a / r, (b - a) / r];
}

/**
 * Columnas de una vela en píxeles reales enteros: la mecha, de un píxel real por cada píxel CSS
 * completo, centrada en el cuerpo. null sin la mejora
 */
export function candleColumns(centerX, bodyWidth) {
  if (!state.on) return null;
  const r = state.rx;
  const wick = Math.max(1, Math.floor(r));
  let body = Math.max(1, Math.round(bodyWidth * r));
  if ((body - wick) % 2 !== 0) body += body > wick ? -1 : 1;
  const wickStart = Math.round(centerX * r - wick / 2);
  const bodyStart = wickStart - (body - wick) / 2;
  return { wickX: wickStart / r, wickWidth: wick / r, bodyX: bodyStart / r, bodyWidth: body / r };
}

// Escala y traslado del lienzo, o null si está girado y no se puede alinear
function transformOf(ctx) {
  if (!ctx.__pixelsMoved) return { a: state.rx, d: state.ry, e: 0, f: 0 };
  const m = ctx.getTransform();
  if (m.b !== 0 || m.c !== 0 || !(m.a > 0) || !(m.d > 0)) return null;
  return m;
}

/**
 * Hace que fillRect y strokeRect de este lienzo caigan en píxeles reales enteros.
 * Solo cambia la posición de los bordes, a lo sumo medio píxel real. Se instala una vez por lienzo.
 */
export function installCrispRects(ctx) {
  if (!proto || !ctx || ctx.__crispRects) return ctx;
  ctx.__crispRects = true;

  // Cualquier giro o traslado obliga a mirar la matriz real hasta el próximo cuadro
  for (const name of ['translate', 'rotate', 'scale', 'transform', 'setTransform', 'resetTransform']) {
    const original = proto[name];
    ctx[name] = function (...args) {
      this.__pixelsMoved = true;
      return original.apply(this, args);
    };
  }

  // Se llama miles de veces por cuadro con muchas velas: sin crear objetos. Un lado de menos de un
  // píxel real se deja como está, o una zona de miles de velas angostas se vería más densa
  ctx.fillRect = function (x, y, w, h) {
    if (!state.on) return proto.fillRect.call(this, x, y, w, h);
    let a = state.rx;
    let d = state.ry;
    let e = 0;
    let f = 0;
    if (this.__pixelsMoved) {
      const t = transformOf(this);
      if (!t) return proto.fillRect.call(this, x, y, w, h);
      ({ a, d, e, f } = t);
    }
    let left = x * a + e;
    let right = (x + w) * a + e;
    if (right < left) { const swap = left; left = right; right = swap; }
    if (right - left >= 1) {
      left = Math.round(left);
      x = (left - e) / a;
      w = (Math.round(right) - left) / a;
    }
    let top = y * d + f;
    let bottom = (y + h) * d + f;
    if (bottom < top) { const swap = top; top = bottom; bottom = swap; }
    if (bottom - top >= 1) {
      top = Math.round(top);
      y = (top - f) / d;
      h = (Math.round(bottom) - top) / d;
    }
    return proto.fillRect.call(this, x, y, w, h);
  };

  // El borde queda centrado en la orilla, como siempre, pero en píxeles enteros. Dos rectángulos que
  // comparten una orilla (las zonas TP y SL de una caja) siguen pintando su borde en el mismo lugar
  ctx.strokeRect = function (x, y, w, h) {
    const t = state.on ? transformOf(this) : null;
    if (!t || !Number.isFinite(x + y + w + h)) return proto.strokeRect.call(this, x, y, w, h);
    const width = this.lineWidth;
    const device = Math.max(1, Math.round(width * t.a));
    // Un grosor impar no puede centrarse en una orilla entera: se corre medio píxel hacia arriba o la izquierda
    const edge = (value, scale, offset) => {
      const pixel = Math.round(value * scale + offset);
      return ((device % 2 === 0 ? pixel : pixel - 0.5) - offset) / scale;
    };
    const left = edge(Math.min(x, x + w), t.a, t.e);
    const right = edge(Math.max(x, x + w), t.a, t.e);
    const top = edge(Math.min(y, y + h), t.d, t.f);
    const bottom = edge(Math.max(y, y + h), t.d, t.f);
    const alpha = this.globalAlpha;
    // Un borde más fino que un píxel real se dibuja de un píxel con la misma tinta
    const ink = width * t.a < 1 ? width * t.a : 1;
    this.lineWidth = device / t.a;
    if (ink < 1) this.globalAlpha = alpha * ink;
    proto.strokeRect.call(this, left, top, right - left, bottom - top);
    this.lineWidth = width;
    this.globalAlpha = alpha;
    return undefined;
  };

  return ctx;
}

/** Al empezar un cuadro, con la escala ya puesta: no hay giros pendientes */
export function resetCanvasMoves(ctx) {
  if (ctx) ctx.__pixelsMoved = false;
}
