// Mapa de liquidez (13/11/2026): la liquidez que esperaba en el libro grabado, por vela y por precio, para dibujarla
// detras de las velas. Los datos salen de la ruta /api/book/heatmap de la suite (book_heatmap.py); aqui se guardan
// por vela, se elige el contraste con lo que esta a la vista y se arma la imagen. Sin React ni canvas: se prueba en
// node (tests/liquiditymap.test.mjs). Cada celda llega en un byte = round(16 * log10(1 + USD)).
// Compra y venta por separado (14/11/2026, pedido del usuario): con `sides`, la ruta manda cells_b y cells_a y cada
// columna guarda las dos (filas de compra y luego filas de venta). La imagen pinta cada precio con el lado que más
// tiene, en su color: así se ve un soporte que pasa a resistencia.

export const ENC = 16;
export const cellUsd = (q) => (q > 0 ? 10 ** (q / ENC) - 1 : 0);

export function decodeCells(b64) {
  if (!b64) return new Uint8Array(0);
  if (typeof atob === 'function') {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

// Las celdas de cada vela, con una sola grilla de precios (paso y primera fila). Si llega otra grilla, empieza de cero.
export class LiquidityMapStore {
  constructor() { this.reset(); }

  reset() {
    this.step = null;
    this.row0 = null;
    this.rows = 0;
    this.frameMs = null;
    this.sides = false;
    this.columns = new Map();   // hora de la vela -> Uint8Array(rows), fila 0 = precio mas bajo
    this.coverage = new Map();  // hora de la vela -> % de sus minutos con libro (0: pedida y sin libro)
    this.firstMs = null;
    this.lastMs = null;
  }

  sameGrid(resp) {
    return this.step === resp.step && this.row0 === resp.row0 && this.rows === resp.rows && this.frameMs === resp.frame_ms
      && this.sides === !!resp.sides;
  }

  // Une una respuesta de la ruta. Devuelve true si cambio algo de lo guardado.
  merge(resp) {
    if (!resp || !resp.cols) return false;
    if (resp.first_ms != null) this.firstMs = this.firstMs == null ? resp.first_ms : Math.min(this.firstMs, resp.first_ms);
    if (resp.last_ms != null) this.lastMs = Math.max(this.lastMs ?? resp.last_ms, resp.last_ms);
    if (!resp.rows) {
      for (let c = 0; c < resp.cols; c++) {
        const t = resp.t0 + c * resp.frame_ms;
        if (!this.columns.has(t)) this.coverage.set(t, 0);
      }
      return false;
    }
    if (!this.sameGrid(resp)) {
      this.reset();
      this.step = resp.step;
      this.row0 = resp.row0;
      this.rows = resp.rows;
      this.frameMs = resp.frame_ms;
      this.sides = !!resp.sides;
      if (resp.first_ms != null) this.firstMs = resp.first_ms;
      if (resp.last_ms != null) this.lastMs = resp.last_ms;
    }
    const sides = !!resp.sides;
    const cells = sides ? null : decodeCells(resp.cells);
    const cellsB = sides ? decodeCells(resp.cells_b) : null;
    const cellsA = sides ? decodeCells(resp.cells_a) : null;
    let changed = false;
    for (let c = 0; c < resp.cols; c++) {
      const t = resp.t0 + c * resp.frame_ms;
      const cov = resp.coverage?.[c] ?? 0;
      if (!cov) {
        if (!this.columns.has(t)) this.coverage.set(t, 0);  // lo que ya tenia libro no se borra
        continue;
      }
      if (sides) {
        const col = new Uint8Array(2 * resp.rows);
        col.set(cellsB.subarray(c * resp.rows, (c + 1) * resp.rows), 0);
        col.set(cellsA.subarray(c * resp.rows, (c + 1) * resp.rows), resp.rows);
        this.columns.set(t, col);
      } else {
        this.columns.set(t, cells.slice(c * resp.rows, (c + 1) * resp.rows));
      }
      this.coverage.set(t, cov);
      changed = true;
    }
    return changed;
  }

  column(t) { return this.columns.get(t) || null; }

  // Velas a la vista que nunca se pidieron
  missing(times) { return times.filter(t => !this.coverage.has(t)); }

  // La grilla alcanza ese rango de precios
  covers(low, high) {
    if (this.step == null) return false;
    return this.row0 * this.step <= low && (this.row0 + this.rows) * this.step >= high;
  }

  priceRange() {
    return this.step == null ? null : [this.row0 * this.step, (this.row0 + this.rows) * this.step];
  }
}

// Contraste con lo que esta a la vista: del percentil lo al hi de las celdas con algo (en bytes). Lo de abajo del
// percentil lo queda transparente: con todo coloreado, el grafico quedaba cubierto por un velo parejo.
export function visibleScale(columns, { lo = 0.3, hi = 0.99 } = {}) {
  const hist = new Uint32Array(256);
  let n = 0;
  for (const col of columns) {
    if (!col) continue;
    for (let i = 0; i < col.length; i++) {
      const q = col[i];
      if (q) { hist[q]++; n++; }
    }
  }
  if (!n) return null;
  const pick = (f) => {
    const target = f * n;
    let acc = 0;
    for (let q = 1; q < 256; q++) {
      acc += hist[q];
      if (acc >= target) return q;
    }
    return 255;
  };
  const a = pick(lo);
  return { lo: a, hi: Math.max(pick(hi), a + 1) };
}

// Rampas de color: lo de poco valor queda transparente, asi se ven las velas y el fondo del estilo.
// En un fondo claro, de celeste a azul, violeta y naranja; en uno oscuro, de violeta a rojo y amarillo.
const LIGHT = [[0, [255, 255, 255, 0]], [0.25, [140, 185, 235, 55]], [0.5, [60, 110, 200, 140]],
  [0.75, [150, 60, 170, 200]], [1, [235, 110, 20, 235]]];
const DARK = [[0, [0, 0, 4, 0]], [0.25, [87, 16, 110, 120]], [0.5, [188, 55, 84, 180]],
  [0.75, [249, 142, 9, 215]], [1, [252, 255, 164, 240]]];

export function ramp(x, dark = false) {
  const stops = dark ? DARK : LIGHT;
  const v = Math.min(1, Math.max(0, x));
  for (let i = 1; i < stops.length; i++) {
    const [x1, c1] = stops[i];
    const [x0, c0] = stops[i - 1];
    if (v <= x1) {
      const f = (v - x0) / (x1 - x0);
      return c0.map((c, k) => Math.round(c + (c1[k] - c) * f));
    }
  }
  return stops[stops.length - 1][1].slice();
}

// Rampa de un lado (compra o venta) en su color: transparente con poco, firme con mucho. En lo más alto el color se
// oscurece (fondo claro) o se aclara (fondo oscuro) para que los muros resalten.
const SIDE_ALPHA = [[0, 0], [0.25, 60], [0.5, 130], [0.75, 195], [1, 240]];
export function sideRamp(x, rgb, dark = false) {
  const v = Math.min(1, Math.max(0, x));
  let a = SIDE_ALPHA[SIDE_ALPHA.length - 1][1];
  for (let i = 1; i < SIDE_ALPHA.length; i++) {
    const [x1, a1] = SIDE_ALPHA[i];
    const [x0, a0] = SIDE_ALPHA[i - 1];
    if (v <= x1) { a = a0 + (a1 - a0) * (v - x0) / (x1 - x0); break; }
  }
  const target = dark ? 255 : 0;
  const k = v > 0.75 ? (v - 0.75) / 0.25 * (dark ? 0.35 : 0.3) : 0;
  return [...rgb.map(c => Math.round(c + (target - c) * k)), Math.round(a)];
}

/** '#2962FF' -> [41, 98, 255]; otra cosa -> fallback */
export function hexRgb(hex, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Imagen RGBA: una columna por vela a la vista y una fila por precio (la de arriba es el precio mas alto).
// Con columnas de compra y venta (2 x rows) y sideColors { b: [r, g, b], a: [r, g, b] }, cada precio va con el lado
// que más tiene, en su color.
export function buildImage(columns, rows, scale, dark = false, opacity = 1, sideColors = null) {
  const w = columns.length;
  const h = rows;
  const data = new Uint8ClampedArray(Math.max(0, w * h * 4));
  if (!scale || !w || !h) return { width: w, height: h, data };
  const lutOf = (fn) => {
    const lut = new Uint8ClampedArray(256 * 4);
    for (let q = 1; q < 256; q++) {
      const c = fn((q - scale.lo) / (scale.hi - scale.lo));
      lut[q * 4] = c[0]; lut[q * 4 + 1] = c[1]; lut[q * 4 + 2] = c[2]; lut[q * 4 + 3] = Math.round(c[3] * opacity);
    }
    return lut;
  };
  const lut = lutOf(x => ramp(x, dark));
  const colors = sideColors || { b: [41, 98, 255], a: [245, 124, 0] };
  const lutB = lutOf(x => sideRamp(x, colors.b, dark));
  const lutA = lutOf(x => sideRamp(x, colors.a, dark));
  for (let c = 0; c < w; c++) {
    const col = columns[c];
    if (!col) continue;
    const split = col.length === 2 * h;
    for (let r = 0; r < h; r++) {
      let q = col[r];
      let L = lut;
      if (split) {
        const qa = col[h + r];
        if (qa > q) { q = qa; L = lutA; } else { L = lutB; }
      }
      if (!q) continue;
      const o = ((h - 1 - r) * w + c) * 4;
      data[o] = L[q * 4]; data[o + 1] = L[q * 4 + 1]; data[o + 2] = L[q * 4 + 2]; data[o + 3] = L[q * 4 + 3];
    }
  }
  return { width: w, height: h, data };
}

// Filtro "solo lo grande" (14/11/2026): de 0 a 100. Sube el corte de abajo del contraste del percentil 30 hasta el 95:
// lo de menos queda transparente.
export const cutPercentile = (cut) => 0.3 + 0.65 * Math.max(0, Math.min(100, Number(cut) || 0)) / 100;
