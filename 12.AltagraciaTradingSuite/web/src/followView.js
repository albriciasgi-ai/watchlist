// Textos y cuentas del módulo "Seguimiento" (24/11/2026, docs/PLAN_SEGUIMIENTO_SCANNER.md), sin React, para probarlos
// con node (tests/follow.test.mjs). El nombre de cada elemento lo pasa la página (elementLabel de App 1).

export const LIST_NAMES = { enjuego: 'En juego', tendencia: 'Tendencia', rapidos: 'Rápidos' };
const COLOMBIA = 5 * 3600 * 1000;   // UTC−5, sin horario de verano

export const short = (s) => String(s || '').replace(/USDT$/, '');

/** "24/11 08:30" en hora de Colombia */
export function whenText(ms) {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms - COLOMBIA).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}`;
}

/** 45 → "45 min", 250 → "4 h 10 min", 120 → "2 h" */
export function minutesText(m) {
  if (!Number.isFinite(m)) return '—';
  const n = Math.round(Math.abs(m));
  const h = Math.floor(n / 60);
  const rest = n % 60;
  const text = h ? `${h} h${rest ? ` ${rest} min` : ''}` : `${rest} min`;
  return m < 0 ? `−${text}` : text;
}

/** Minutos desde el hallazgo, con signo: "+2 h 15 min", "−30 min", "hallazgo" */
export function offsetText(m) {
  if (!Number.isFinite(m)) return '—';
  if (Math.round(m) === 0) return 'hallazgo';
  return m > 0 ? `+${minutesText(m)}` : minutesText(m);
}

export const sideText = (side) => (side > 0 ? '↑' : side < 0 ? '↓' : '·');

export function num(x, digits = 1) {
  if (x === null || x === undefined || !Number.isFinite(Number(x))) return '—';
  return Number(x).toFixed(digits);
}

export function signed(x, digits = 1) {
  if (x === null || x === undefined || !Number.isFinite(Number(x))) return '—';
  const v = Number(x);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;
}

export const pct = (x, digits = 0) => (x === null || x === undefined ? '—' : `${Number(x).toFixed(digits)} %`);

/** Lo de una fracción como porcentaje con signo: 0.021 → "+2.1 %" */
export const fracPct = (x, digits = 1) => (x === null || x === undefined ? '—' : `${signed(Number(x) * 100, digits)} %`);

export function listText(row) {
  const name = LIST_NAMES[row.list] || (row.kind === 'control' ? 'Control' : row.list || '—');
  return row.startup ? `${name} · arranque` : name;
}

/** Lo que pasó, en corto: abierto (con lo que va), el movimiento importante o lo que falta */
export function stateText(row) {
  if (row.state === 'abierto') {
    const now = row.now_atr === null || row.now_atr === undefined ? '' : ` · ${signed(row.now_atr)} ATR a favor`;
    return `abierto hace ${minutesText(Math.max(0, row.elapsed_min || 0))}${now}`;
  }
  if (row.state === 'sin datos') return 'sin datos de Bybit';
  const big = row.o?.big;
  if (!big) return 'sin moverse 3 ATR';
  return `${big.way} a los ${minutesText(big.min)}`;
}

export const TOUCH_TEXT = { sigue: 'sigue', gira: 'gira', 'las dos': 'las dos a la vez', ninguna: 'ninguna' };
export const touchText = (row) => (row.state === 'abierto' ? '…' : TOUCH_TEXT[row.o?.touch] || '—');

/** 4 h: "1.2 / 0.8" (a favor / en contra, en ATR) */
export function favAdv(h) {
  if (!h) return '—';
  return `${num(h.fav)} / ${num(h.adv)}`;
}

/** La llave de un elemento ("QB|15|+") en palabras: "Ruptura con volumen · 15m · a favor" */
export function signalText(key, label = (c) => c) {
  const [code, tf, rel] = String(key).split('|');
  return `${label(code)} · ${tf === '60' ? '1h' : `${tf}m`} · ${rel === '+' ? 'a favor' : 'en contra'}`;
}

/** Los elementos al hallazgo en corto, para la tabla: "QB 15m ↑, FV 1h ↓" (las flechas, respecto del lado) */
export function signalsShort(keys, max = 4) {
  const list = (keys || []).map((key) => {
    const [code, tf, rel] = key.split('|');
    return `${code} ${tf === '60' ? '1h' : `${tf}m`}${rel === '+' ? '+' : '−'}`;
  });
  return list.length > max ? `${list.slice(0, max).join(', ')} y ${list.length - max} más` : list.join(', ') || '—';
}

/**
 * Las listas en sus 24 h, por lista: "En juego 08:30–11:15 · Rápidos 3 veces, 1 h 5 min en total". Una moneda con el
 * libro justo en el límite entra y sale muchas veces: se cuenta en lugar de nombrar cada vez. `end`: hasta cuándo se
 * cuenta lo que sigue abierto (de fábrica, la última hora conocida).
 */
export function timelineText(lists, end = null) {
  if (!lists?.length) return '—';
  const by = new Map();
  for (const [list, from, to, gap] of lists) {
    if (!by.has(list)) by.set(list, []);
    by.get(list).push({ from, to, gap });
  }
  return [...by.entries()].map(([list, items]) => {
    const name = LIST_NAMES[list] || list;
    if (items.length === 1) {
      const { from, to, gap } = items[0];
      return `${name} ${whenText(from).slice(6)}–${to ? whenText(to).slice(6) + (gap ? ' (corte)' : '') : '…'}`;
    }
    const last = end ?? Math.max(...items.map(x => x.to || x.from));
    const total = items.reduce((sum, x) => sum + ((x.to || last) - x.from), 0) / 60000;
    return `${name} ${items.length} veces, ${minutesText(total)} en total`;
  }).join(' · ');
}

/**
 * Velas de 5 min de la serie unidas de a `group` (15 min de fábrica) para el gráfico: [{i, t, o, h, l, c, v}]. Una vela
 * sin precio se salta.
 */
export function groupBars(series, group = 3) {
  const out = [];
  if (!series?.c?.length) return out;
  for (let i = 0; i < series.c.length; i += group) {
    let o = null; let h = -Infinity; let l = Infinity; let c = null; let v = 0;
    for (let j = i; j < Math.min(i + group, series.c.length); j++) {
      if (series.c[j] === null || series.c[j] === undefined) continue;
      if (o === null) o = series.o[j];
      h = Math.max(h, series.h[j]);
      l = Math.min(l, series.l[j]);
      c = series.c[j];
      v += series.v?.[j] || 0;
    }
    if (o === null) continue;
    out.push({ i, t: series.start + i * series.step, o, h, l, c, v });
  }
  return out;
}

/** El rango del precio para el gráfico, con las líneas de ±3 ATR siempre a la vista */
export function priceRange(bars, lines = 3) {
  let lo = -lines; let hi = lines;
  for (const b of bars) {
    lo = Math.min(lo, b.l);
    hi = Math.max(hi, b.h);
  }
  const pad = (hi - lo) * 0.06 || 1;
  return [lo - pad, hi + pad];
}

/**
 * Las filas de elementos del gráfico: una por elemento y marco con alguna señal en las 48 h (a lo sumo `max`). Primero
 * los que se encendieron en `focus` (rangos de minutos: alrededor del hallazgo y antes del movimiento importante) y,
 * dentro de cada grupo, los que menos se encienden: uno que se enciende a cada rato dice poco de un momento. Cada señal
 * con su minuto y su dirección (arriba o abajo, no respecto del lado).
 */
export function signalRows(signals, max = 16, focus = [[-60, 60]]) {
  const rows = new Map();
  for (const [code, tf, off, dir] of signals || []) {
    const key = `${code}|${tf}`;
    if (!rows.has(key)) rows.set(key, { key, code, tf, items: [], focus: false });
    const row = rows.get(key);
    row.items.push({ off, dir });
    if (focus.some(([a, b]) => off >= a && off <= b)) row.focus = true;
  }
  const list = [...rows.values()].sort((a, b) => (b.focus - a.focus) || a.items.length - b.items.length
    || a.code.localeCompare(b.code) || a.tf - b.tf);
  return { rows: list.slice(0, max), hidden: Math.max(0, list.length - max) };
}

/** Lo que se encendió cerca del hallazgo (de `from` a `to` minutos), en orden */
export function nearSignals(signals, side, from = -60, to = 240) {
  return (signals || [])
    .filter(([, , off]) => off >= from && off <= to)
    .map(([code, tf, off, dir]) => ({ code, tf, off, dir, favor: dir === side }))
    .sort((a, b) => a.off - b.off || a.tf - b.tf);
}

/** El valor de una fila del informe: "62 % de 42" */
export function rateText(value, n) {
  if (!n) return '—';
  return `${value === null || value === undefined ? '—' : `${Number(value).toFixed(0)} %`} de ${n}`;
}
