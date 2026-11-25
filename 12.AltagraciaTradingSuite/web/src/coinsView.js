// Textos del módulo "Monedas" (23/11/2026, docs/PLAN_MONEDAS.md): lo que se dice de cada moneda a partir de lo que da
// GET /api/coins. Sin React, para probarlo con node (web/tests/coins.test.mjs).

export const short = (s) => String(s || '').replace(/USDT$/, '');

export function mbText(mb) {
  if (mb === null || mb === undefined || !Number.isFinite(mb)) return '—';
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

export function etaText(hours) {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return '';
  if (hours < 1) return `unos ${Math.max(1, Math.round(hours * 60))} min`;
  return `unas ${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
}

export const dayShort = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
export const dayLong = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');

const num = (n) => Number(n || 0).toLocaleString('en-US');

/** El avance de una descarga en una línea: "950 de 1,820 días (52 %) · unas 1.8 h". */
export function progressText(p) {
  if (!p) return 'empezando…';
  const total = p.done + p.left;
  const bits = [`${num(p.done)} de ${num(total)} días${p.pct !== null && p.pct !== undefined ? ` (${Math.round(p.pct)} %)` : ''}`];
  if (p.per_hour) bits.push(`${num(p.per_hour)} días por hora`);
  const eta = etaText(p.eta_h);
  if (eta) bits.push(`faltan ${eta}`);
  return bits.join(' · ');
}

/**
 * El almacén de una moneda: lo que se dice y la acción que se ofrece.
 * action: 'download' (bajar la historia), 'continue' (seguir bajando), 'cancel' (sacar de la espera) o null.
 */
export function storeText(store, available = true) {
  const s = store || {};
  const days = s.store_days ? `${num(s.store_days)} días desde el ${dayLong(s.first_day)}` : '';
  const build = s.build;
  const buildFailed = build && !build.ok;
  const launchFailed = s.launch && s.launch.code !== 0;
  const fail = launchFailed ? `La última descarga terminó con error: ${s.launch.detail || `código ${s.launch.code}`}` : '';
  switch (s.state) {
    case 'bajando':
      return { text: `Bajando · ${s.progress ? `${Math.round(s.progress.pct ?? 0)} %` : 'empezando'}`, title: progressText(s.progress), action: null, tone: 'warn' };
    case 'en_espera':
      return { text: `En espera${s.queue_position ? ` (n.º ${s.queue_position})` : ''}`, title: 'Se baja cuando termine la descarga en curso: una moneda a la vez, como en el panel de Order Flow', action: 'cancel', tone: 'warn' };
    case 'armando':
      return { text: 'Armando el almacén…', title: 'build_store.py arma sus footprints por minuto y su flujo', action: null, tone: 'warn' };
    case 'sin_historia':
      return { text: 'Sin historia', title: fail || 'Bybit publica sus trades de cada día desde que cotiza: el almacén los baja y arma sus footprints', action: available ? 'download' : null, tone: fail ? 'bad' : null };
    case 'a_medias': {
      const left = s.missing_remote !== null && s.missing_remote !== undefined ? `faltan ${num(s.missing_remote)} días` : 'la última descarga no terminó';
      return { text: `A medias · ${left}`, title: [fail, days].filter(Boolean).join('. ') || left, action: available ? 'continue' : null, tone: 'warn' };
    }
    case 'por_armar': {
      const missing = Math.max(s.missing_store || 0, s.missing_flow || 0);
      if (buildFailed) {
        return { text: 'No se pudo armar', title: `El armado del almacén falló: ${build.detail || `código ${build.code}`}. Se vuelve a intentar en unas horas.`, action: null, tone: 'bad' };
      }
      return { text: `Por armar · ${num(missing)} días`, title: 'Se arma solo cuando nadie lo esté armando y la descarga haya terminado hace unos minutos', action: null, tone: 'warn' };
    }
    case 'al_dia':
      // Con el almacén apagado ya no se pone al día: se dice hasta dónde llega, sin "al día"
      return { text: `${s.store_on === false ? 'Hasta' : 'Al día hasta'} el ${dayShort(s.store_last)}`, title: days, action: null, tone: s.store_on === false ? null : 'ok' };
    default:
      return { text: '—', title: '', action: null, tone: null };
  }
}

const RECORDERS = { trades: 'los trades', book: 'el libro', hl: 'Hyperliquid' };

/** La nota junto a una casilla de grabación: si vale ya, al reiniciar o no corre aquí. */
export function recordNote(row, key, recorders) {
  const opt = row?.options?.[key];
  const now = row?.recording?.[key];
  if (!row?.suite) return { text: '', title: `Agrégala a la suite para grabar ${RECORDERS[key]}` };
  if (now === 'closed') return { text: 'cerrada', title: 'Bybit no la da como "Trading": el libro no se graba' };
  if (!opt && now === 'on') return { text: 'hasta reiniciar', title: `Se deja de grabar ${RECORDERS[key]} al reiniciar la suite` };
  if (now === null || now === undefined) {
    const why = recorders?.[key]?.why;
    return { text: '', title: why ? `No corre en este servidor: ${why}` : '' };
  }
  if (opt && now === 'off') return { text: 'empieza…', title: 'Encendido: el grabador la suma en unos segundos' };
  return { text: '', title: opt ? `Se graba ${RECORDERS[key]} en este PC` : `No se graba ${RECORDERS[key]}` };
}

/** La lista del Swing con la moneda puesta o quitada; null si quedaría vacía (el Swing pide al menos una). */
export function swingNext(list, sym, on) {
  const cur = Array.isArray(list) ? list : [];
  const next = on ? (cur.includes(sym) ? cur : [...cur, sym]) : cur.filter(s => s !== sym);
  return next.length ? next : null;
}

/** El total de lo que escribe por día la grabación de las monedas de la suite, con cuántas lo estiman. */
export function perDayTotal(rows) {
  let mb = 0;
  let estimates = 0;
  for (const r of rows || []) {
    if (!r.suite || !r.per_day) continue;
    mb += r.per_day.total_mb || 0;
    if (r.per_day.estimate) estimates += 1;
  }
  return { mb: Math.round(mb * 10) / 10, estimates };
}
