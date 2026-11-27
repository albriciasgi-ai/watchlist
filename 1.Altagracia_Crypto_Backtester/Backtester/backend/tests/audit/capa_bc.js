// Capas B y C del protocolo (21/11/2026). Lo sirve el receptor (GET http://127.0.0.1:9399/helper.js) y la página
// aislada lo carga con: await import('http://127.0.0.1:9399/helper.js?v=' + Date.now())
// No cambia nada de la app: elige trades como un clic del usuario, lee el texto del detalle y, para la captura, encuadra
// el gráfico en el trade (zoom y desplazamiento, como la rueda y "ir al trade") y pone ENCIMA un lienzo con el área de
// precios ampliada, que manda al receptor junto con el texto.
//   await __audit.ready()                        -> abre la pestaña Trades y espera la lista y el gráfico
//   await __audit.shot(carpeta, n, tfMin, opts)  -> elige el trade n, encuadra, amplía y guarda; devuelve una línea
//   await __audit.showPart(carpeta, n, tf, 'inicio'|'fin'|'completo')
//   __audit.clear()                              -> quita el lienzo de encima
// Las esperas van por un Worker: con el panel del navegador oculto, la página frena sus temporizadores (hasta uno por
// minuto) y los de un Worker no (es lo que hace la app con su reloj, startTicker). El gráfico dibuja al pedirlo.
let sleepWorker = null, sleepSeq = 0;
const sleepWaiters = new Map();
const sleep = (ms) => new Promise((resolve) => {
  try {
    if (!sleepWorker) {
      const src = 'onmessage = (e) => setTimeout(() => postMessage(e.data.id), e.data.ms);';
      sleepWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      sleepWorker.onmessage = (e) => { const r = sleepWaiters.get(e.data); if (r) { sleepWaiters.delete(e.data); r(); } };
    }
    const id = ++sleepSeq;
    sleepWaiters.set(id, resolve);
    sleepWorker.postMessage({ id, ms });
  } catch (e) {
    setTimeout(resolve, ms);
  }
});
const RECEPTOR = 'http://127.0.0.1:9399';
const fiberOf = (el) => el && el[Object.keys(el).find(k => k.startsWith('__reactFiber$'))];
const hookRefs = (fiber) => {
  const out = [];
  for (let h = fiber.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
    const s = h.memoizedState;
    if (s && typeof s === 'object' && 'current' in s) out.push(s);
  }
  return out;
};

function chartFiber() {
  // MiniChart es un forwardRef anónimo: el primer componente hacia arriba con un ref de vista {zoom, offset}
  let f = fiberOf(document.querySelector('canvas'));
  while (f) {
    const refs = typeof f.type !== 'string' ? hookRefs(f) : [];
    if (refs.some(r => r.current && typeof r.current === 'object' && 'zoom' in r.current && 'offset' in r.current)) return { f, refs };
    f = f.return;
  }
  return null;
}

function chart() {
  const got = chartFiber();
  if (!got) return null;
  const { f, refs } = got;
  const find = (test) => { const r = refs.find(x => { try { return x.current && test(x.current); } catch (e) { return false; } }); return r && r.current; };
  let handle = null;
  for (let g = f; g && !handle; g = g.return) {
    if (g.ref && typeof g.ref === 'object' && g.ref.current && typeof g.ref.current.focusOn === 'function') handle = g.ref.current;
  }
  const n = handle ? handle.candleCount() : 0;
  return {
    canvas: document.querySelector('canvas'), handle,
    view: find(c => 'zoom' in c && 'offset' in c && 'verticalZoom' in c),
    scale: find(c => typeof c.timeToX === 'function' && typeof c.priceToY === 'function'),
    ps: find(c => 'priceAreaEnd' in c && 'chartWidth' in c),
    candles: find(c => Array.isArray(c) && c.length === n && n > 0 && c[0] && 'timestamp' in c[0]),
  };
}

function indicatorManager() {
  // El IndicatorManager del gráfico (un ref de MiniChart): sus indicadores, con su configuración en vivo
  const got = chartFiber();
  const ref = got && got.refs.find(r => r.current && Array.isArray(r.current.indicators) && typeof r.current.renderIndicators === 'function');
  return ref ? ref.current : null;
}

function setOrderFlow(of = {}) {
  // Galería 4 (25/11/2026): el footprint con el step de análisis de los elementos (of_elements.analysis_step), así sus
  // celdas son las del elemento, con los desequilibrios del elemento (diagonal de 4 a 1, apilados de 3); y los Elementos
  // OF con solo el código del elemento y la tabla de la vela. No guarda nada: vale hasta recargar la página
  const im = indicatorManager();
  if (!im) return '⚠ sin IndicatorManager';
  const out = [];
  const flow = im.indicators.find(x => x.name === 'Order Flow');
  if (flow && of.step) {
    // stepPerCandle (25/11, O-39): el tope de 200 niveles es de cada vela. Sin él, una vela ancha de lo encuadrado
    // agrandaba las celdas de todas (8 casos de la galería 4 salieron así y se repitieron)
    // Sin imbalanceCountZero: of_elements cuenta un desequilibrio frente a un 0 (E-10), pero pintarlos llenaba el gráfico
    // de franjas de apilados (probado el 26/11 con la recarga 593). Las celdas del elemento las señala su marco
    flow.updateConfig({ stepByMinutes: { [flow.tfMinutes]: of.step }, stepPerCandle: true, imbalanceRatio: 4,
                        imbalanceMode: 'diagonal', stackedMinLevels: 3, showImbalances: of.imbalances !== false,
                        imbalanceCountZero: false });
    out.push(`footprint con celdas de ${of.step}` + (flow.enabled ? '' : ' ⚠ apagado'));
  }
  const elements = im.indicators.find(x => x.name === 'Elementos OF');
  if (elements && of.codes) {
    const codes = Object.fromEntries(Object.keys(elements.config.codes).map(code => [code, of.codes.includes(code)]));
    elements.updateConfig({ codes, showTable: true, showBands: true, showGlyphs: true, showEMA: false });
    out.push(`Elementos OF: ${of.codes.join(', ')}` + (elements.enabled ? '' : ' ⚠ apagado'));
  }
  return out.join(' · ');
}

async function footprintReady(t, ms) {
  // Hasta `ms`: el footprint de la vela t cargado y sin pedidos en curso, dos veces seguidas (un cambio de configuración
  // en medio lo descarta)
  const end = Date.now() + ms;
  let ok = 0;
  while (Date.now() < end) {
    const im = indicatorManager();
    const flow = im && im.indicators.find(x => x.name === 'Order Flow');
    ok = flow && !flow.isLoading && flow.footprintMap.get(t) ? ok + 1 : 0;
    if (ok >= 2) return true;
    // El indicador pide sus footprints al dibujarse: sin redibujar, un mapa vacío se queda vacío
    const c = chart();
    if (c && c.handle) c.handle.forceRedraw();
    await sleep(500);
  }
  return false;
}

async function steadyCloseUp(t, of, step, ms) {
  // De cerca, con la casilla del contexto desmarcada: la app devuelve el footprint a lo guardado un momento después
  // (O-39) y pisa las celdas del elemento. Se vuelven a poner hasta que se mantienen y la vela t tiene su footprint
  const end = Date.now() + ms;
  let ok = 0;
  while (Date.now() < end) {
    const im = indicatorManager();
    const flow = im && im.indicators.find(x => x.name === 'Order Flow');
    if (flow && ((flow.config.stepByMinutes || {})[flow.tfMinutes] !== step || !flow.config.stepPerCandle)) {
      setOrderFlow({ codes: [], step, imbalances: of.imbalances });
      ok = 0;
    } else {
      ok = flow && !flow.isLoading && flow.footprintMap.get(t) ? ok + 1 : 0;
      if (ok >= 3) return true;
    }
    const c = chart();
    if (c && c.handle) c.handle.forceRedraw();
    await sleep(500);
  }
  return false;
}

function footprintCheck(t, want) {
  // Las celdas con que el footprint dibujó la vela t: el servidor las agranda si alguna vela de lo pedido pasaría de
  // 200 niveles (footprint_store.MAX_LEVELS_PER_CANDLE)
  const im = indicatorManager();
  const flow = im && im.indicators.find(x => x.name === 'Order Flow');
  const fp = flow && flow.footprintMap.get(t);
  if (!fp) return '⚠ sin el footprint de la vela de la señal';
  const step = Number(fp.step_size);
  return Math.abs(step - want) < 1e-9 ? `celdas de ${step}` : `⚠ el footprint dibuja celdas de ${step} (pedidas ${want})`;
}

const rows = () => [...document.querySelectorAll('table tr')].filter(r => /^\d+$/.test((r.cells[0]?.textContent || '').trim()));

function detailText() {
  const g = [...document.querySelectorAll('.rt-group')].find(x => /^Trade \d+/.test(x.innerText.trim()));
  return g ? g.innerText.replace(/ /g, ' ') : null;
}

function signalTable() {
  const t = [...document.querySelectorAll('table')].find(x => /✓|✗/.test(x.innerText) && !/^\s*#/.test(x.innerText));
  return t ? [...t.rows].map(r => [...r.cells].map(c => c.innerText.trim().replace(/ /g, ' '))) : null;
}

async function ready() {
  // Etapa 6: al terminar de cargar la corrida la página vuelve sola al Resumen; si "Trades" se pulsó antes, la lista
  // no aparece y la cola fallaba con "No está la fila del trade 1" (casi siempre en el primer elemento de una cola
  // nueva, cuando la carga es lenta). Se vuelve a pulsar mientras no esté activa.
  for (let i = 0; i < 160 && !(rows().length && chart() && chart().ps && chart().candles); i++) {
    const tab = [...document.querySelectorAll('button')].find(b => /^Trades/.test(b.innerText.trim()));
    if (tab && !/\bon\b/.test(tab.className)) tab.click();
    await sleep(500);
  }
  for (let i = 0; i < 160 && /Pidiendo las velas/.test(document.body.innerText); i++) await sleep(500);
  const c = chart();
  return `listo: ${rows().length} trades; gráfico ${c && c.ps ? 'sí' : 'no'}; velas ${c && c.candles ? c.candles.length : 0}`;
}

async function select(n) {
  const row = rows().find(r => r.cells[0].textContent.trim() === String(n));
  if (!row) throw new Error('No está la fila del trade ' + n);
  row.scrollIntoView({ block: 'nearest' });
  row.click();
  for (let i = 0; i < 160; i++) {
    await sleep(250);
    const txt = detailText() || '';
    const body = document.body.innerText;
    if (txt.startsWith('Trade ' + n + ' ') && !/repitiendo la regla para dibujarlo/.test(body)
        && /Al cerrar la vela de la señal|no se cumpl|no se pudo|no da el mismo|no se repite/i.test(body)) return true;
  }
  return false;
}

function parseTimes(txt) {
  // "Señal dd/mm/aa, hh:mm a. m. · entrada ... · salida ..." en hora de Colombia (UTC−5)
  const re = /(\d{2})\/(\d{2})\/(\d{2}), (\d{1,2}):(\d{2})\s*([ap])\.\s*m\./g;
  const out = [];
  let m;
  while ((m = re.exec(txt))) {
    const h = Number(m[4]) % 12 + (m[6] === 'p' ? 12 : 0);
    out.push(Date.UTC(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1]), h + 5, Number(m[5])));
  }
  return out;
}

async function frame(start, end, tfMs, maxWidth = 48, minBars = 12) {
  // Encuadra [start, end]: el zoom y el desplazamiento se fijan a mano, porque "ir al trade" fuerza velas de 6 px.
  // La ventana vuelve a enfocar el trade cuando le llega su contexto: se comprueba que lo dibujado sea el rango
  // pedido y, si no, se encuadra otra vez (antes, alguna captura salió con el encuadre del trade anterior).
  let c = chart();
  c.handle.focusOn(start, null, { mark: false });
  await sleep(150);
  for (let attempt = 0; attempt < 6; attempt++) {
    c = chart();
    const arr = c.candles;
    const cw = c.ps.chartWidth;
    // Etapa 6: las velas a mostrar se cuentan con el paso del gráfico, no con el de la regla. Una regla de 1D mirada en
    // 4H (o de 30m en 15M) mostraba 6 veces (o 2) menos tiempo del pedido, y la captura podía no llegar al trade
    const step = Math.min(tfMs, chartStep(arr) || tfMs);
    const bars = Math.max(minBars, Math.round((end - start) / step) + 1);
    const width = Math.max(1, Math.min(maxWidth, cw / bars));  // maxWidth: etapa 7, velas anchas para ver el footprint con cifras
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].timestamp < start) lo = mid + 1; else hi = mid; }
    const per = Math.floor(cw / width);
    c.view.zoom = width / 8;
    c.view.offset = Math.max(0, arr.length - per - lo);
    c.view.verticalZoom = 1;
    c.view.verticalOffset = 0;
    c.handle.forceRedraw();
    await sleep(350 + attempt * 250);
    c = chart();
    const vis = (c.scale && c.scale.visibleCandles) || [];
    const lastTs = arr.length ? arr[arr.length - 1].timestamp : end;
    if (vis.length && vis[0].timestamp <= Math.max(start, arr[0].timestamp) + step
        && vis[vis.length - 1].timestamp >= Math.min(end, lastTs) - step) return c;
  }
  return chart();
}

function clear() {
  const o = document.getElementById('__audit_overlay');
  if (o) o.remove();
}

function overlay(c, caption, panels) {
  clear();
  const src = c.canvas;
  const sh = panels ? src.height : Math.min(src.height, Math.ceil(c.ps.priceAreaEnd + 6));
  const sw = src.width;
  const W = window.innerWidth, H = window.innerHeight - 30;
  const k = Math.min(W / sw, H / sh);
  const ov = document.createElement('div');
  ov.id = '__audit_overlay';
  ov.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;background:#fff;';
  const cap = document.createElement('div');
  cap.style.cssText = 'height:30px;font:600 13px/30px Segoe UI,Arial;padding:0 8px;background:#111;color:#fff;white-space:nowrap;overflow:hidden;';
  cap.textContent = caption;
  const cv = document.createElement('canvas');
  cv.width = Math.round(sw * k);
  cv.height = Math.round(sh * k);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, cv.width, cv.height);
  ov.appendChild(cap);
  ov.appendChild(cv);
  document.body.appendChild(ov);
  return { k: Math.round(k * 100) / 100, sh };
}

async function post(kind, folder, name, body) {
  const r = await fetch(`${RECEPTOR}/${kind}?carpeta=${encodeURIComponent(folder)}&nombre=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'Content-Type': kind === 'json' ? 'application/json' : 'text/plain' },
    body: kind === 'json' ? JSON.stringify(body) : body,
  });
  return r.ok;
}

const captionOf = (txt, part) => {
  const lines = (txt || '').split('\n');
  return `${lines[0] || ''}${part ? ' · ' + part.toUpperCase() : ''}  ·  ${(lines[1] || '').replace(/^Señal /, 'señal ')}`;
};

async function prepare(n, tfMinutes, opts = {}) {
  clear();
  const ok = await select(n);
  const txt = detailText() || '';
  const times = parseTimes(txt);
  const tfMs = tfMinutes * 60000;
  let of = opts.of ? setOrderFlow({ ...opts.of, step: (opts.of.steps || {})[n] }) : null;
  if (times.length >= 3) {
    const [signal, , exit] = times;
    const until = opts.until === 'signal' ? signal + (opts.after ?? 5) * tfMs : exit + (opts.after ?? 5) * tfMs;
    const c = await frame(signal - (opts.before ?? 8) * tfMs, until, tfMs, opts.maxWidth || 48, opts.minBars || 12);
    // Etapa 7 (galería de elementos): con el footprint encendido, sus celdas llegan del servidor después de encuadrar.
    // opts.settle: ms de espera antes de copiar el lienzo; opts.until 'signal': encuadra alrededor de la señal y no
    // hasta la salida, para ver el elemento con velas anchas
    if (opts.settle) { await sleep(opts.settle); c.handle.forceRedraw(); await sleep(300); }
    // 26/11: con el backend recién encendido, el contexto del trade (y con él el step del elemento, O-39) tarda, y cada
    // cambio de la configuración descarta los footprints que venían. Se espera a que la vela de la señal tenga el suyo
    if (opts.of && (opts.of.steps || {})[n]) { await footprintReady(signal, 45000); c.handle.forceRedraw(); await sleep(300); }
    if (of && (opts.of.steps || {})[n]) of += ' · ' + footprintCheck(signal, opts.of.steps[n]);
    // Galería 5 (25/11/2026): opts.fit[n] = [bajo, alto] que tiene que verse entero, además de las velas (el área de
    // valor de la sesión anterior, que quedaba cortada)
    const fit = (opts.fit || {})[n];
    if (fit) {
      const d = await drawn();
      const lo = Math.min(fit[0], d.ps.minPrice), hi = Math.max(fit[1], d.ps.maxPrice), room = (hi - lo) * 0.04;
      if (showPrices(d, lo - room, hi + room)) await drawn();
    }
    overlay(c, captionOf(txt), !!opts.panels);
  }
  return { n, ready: ok, detail: txt, table: signalTable(), times, ...(of ? { of } : {}) };
}

function showPrices(c, lo, hi) {
  // La escala de precios justo en [lo, hi] (zoom y desplazamiento verticales, como Ctrl + rueda). Galería (25/11/2026)
  const ps = c && c.ps;
  if (!ps || !(hi > lo) || !(ps.maxPrice > ps.minPrice)) return false;
  const H = ps.priceChartHeight;
  c.view.verticalZoom = (ps.maxPrice - ps.minPrice) / (hi - lo);
  c.view.verticalOffset = (hi - ps.minPrice) * (H / (hi - lo)) - H;
  c.handle.forceRedraw();
  return true;
}

async function closeUp(folder, name, n, info, tf, of) {
  // Galería 4 (25/11/2026): la imagen de cerca de un elemento de order flow. Pocas velas alrededor de la señal, anchas,
  // y el precio ampliado en la zona del elemento (of.zones[n], las celdas que dio of_elements) con unos `levels` niveles
  // de alto, para que el footprint muestre las cifras de cada celda. Solo el área de precios
  const tfMs = tf * 60000;
  const [signal] = info.times || [];
  if (!signal) return false;
  // 26/11 (motor 8): la absorción va desde su primer intento (closeBefores, por caso)
  const before = (of.closeBefores || {})[n] ?? of.closeBefore ?? 2, after = of.closeAfter ?? 1;
  // De cerca va sin lo que dibuja la regla ni la marca de los Elementos OF: sus rellenos y la etiqueta de la franja del
  // elemento tapaban las cifras de su celda. Las celdas del elemento las señala un marco fino, sobre la copia
  // 26/11: la casilla del contexto queda marcada. Desde O-39, desmarcarla devolvía el footprint a lo guardado (celdas
  // automáticas) y la vela de la señal se quedaba sin footprint; lo que dibuja la regla se quita igual, vaciando las
  // franjas (abajo). Los Elementos OF van sin marcas, con las celdas del elemento
  const context = await contextShown(true);
  setOrderFlow({ codes: [], step: (of.steps || {})[n], imbalances: of.imbalances });
  // Las franjas del trade elegido (la zona de cada elemento, con su nombre encima de las celdas) salen solo de esta copia:
  // el arreglo de getTradeBands se vacía y se devuelve al terminar
  const props = (chartFiber() || {}).f?.memoizedProps || {};
  const bands = typeof props.getTradeBands === 'function' ? props.getTradeBands() : null;
  const kept = Array.isArray(bands) ? bands.splice(0) : null;
  await frame(signal - before * tfMs, signal + after * tfMs, tfMs, of.closeWidth || 400, before + after + 1);
  let c = await drawn();
  // Una zona [bajo, alto] o varias [[bajo, alto], ...] (26/11, galería 4): el Thin Print y la recarga de desequilibrios
  // marcan cada celda suya, sin las de en medio. La imagen se amplía a todas juntas
  const given = (of.zones || {})[n], step = (of.steps || {})[n];
  const zones = !given ? [] : Array.isArray(given[0]) ? given : [given];
  const zone = zones.length ? [Math.min(...zones.map(z => z[0])), Math.max(...zones.map(z => z[1]))] : null;
  if (zone && step && c && c.ps) {
    const pad = Math.max(3, ((of.levels || 26) - (zone[1] - zone[0]) / step) / 2) * step;
    const lo = zone[0] - pad, hi = zone[1] + pad;
    if (c.ps.maxPrice - c.ps.minPrice > hi - lo) showPrices(c, lo, hi);
  }
  await sleep(of.closeSettle ?? 1500);
  if (step) await steadyCloseUp(signal, of, step, 30000);
  c = await drawn();
  const check = step ? footprintCheck(signal, step) : '';
  overlay(c, captionOf(info.detail, 'de cerca') + ' · el marco azul son las celdas del elemento', false);
  // Una zona puede traer la hora de su vela (la absorción: el marco en cada intento); sin ella, la vela de la señal
  const marked = zones.length ? zones.map(z => outline(c, z[2] ?? signal, z)).every(Boolean) : false;
  const cv = document.querySelector('#__audit_overlay canvas');
  const saved = cv ? await post('img', folder, name + '_cerca', cv.toDataURL('image/jpeg', 0.86)) : false;
  if (kept && bands.length === 0) bands.push(...kept);
  if (context) await contextShown(true);
  return (saved ? 'de cerca' : '⚠ de cerca sin guardar') + (check ? ': ' + check : '') + (zone && !marked ? ' ⚠ sin el marco' : '')
    + (context ? '' : ' ⚠ sin la casilla de lo que usó la regla');
}

async function contextShown(on) {
  // La casilla «Ver en el gráfico lo que usó la regla» del detalle del trade elegido
  const label = [...document.querySelectorAll('label')].find(l => /lo que usó la regla/.test(l.innerText || ''));
  const box = label && label.querySelector('input[type=checkbox]');
  if (!box) return false;
  if (box.checked !== on) { box.click(); await sleep(600); }
  return true;
}

async function drawn() {
  // Un dibujo seguro antes de leer la escala: drawChart salta el cuadro si el anterior fue hace menos de 33 ms y lo deja
  // a requestAnimationFrame, que con el panel del navegador oculto no corre. Dos pedidos separados dibujan, y la escala
  // (ps) queda al día (una imagen de cerca salió ampliada con la escala de la vista anterior)
  chart().handle.forceRedraw();
  await sleep(80);
  chart().handle.forceRedraw();
  await sleep(80);
  return chart();
}

function outline(c, signal, zone) {
  // Un marco fino en las celdas del elemento (zona de precios en la vela de la señal), sobre la copia del lienzo
  const cv = document.querySelector('#__audit_overlay canvas');
  const s = c && c.scale;
  if (!cv || !s) return false;
  const x = s.timeToX(signal);
  if (x === null || x === undefined) return false;
  const bar = s.chartWidth / s.visibleCandles.length;
  const ratio = c.canvas.width / c.canvas.getBoundingClientRect().width;  // píxeles del lienzo por píxel CSS
  const k = cv.width / c.canvas.width;
  const px = (v) => v * ratio * k;
  const top = px(s.priceToY(zone[1])), bottom = px(s.priceToY(zone[0]));
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = '#1E5BFF';
  ctx.lineWidth = Math.max(2, Math.round(2 * k));
  ctx.strokeRect(px(x - bar / 2) + 1, top - 1, px(bar) - 2, bottom - top + 2);
  return true;
}

async function shoot(folder, n, tf, opts = {}) {
  const info = await prepare(n, tf, opts);
  const name = `trade_${String(n).padStart(4, '0')}`;
  let saved = false;
  let cv = document.querySelector('#__audit_overlay canvas');
  if (cv) saved = await post('img', folder, name + (opts.panels ? '_paneles' : ''), cv.toDataURL('image/jpeg', 0.86));
  if (opts.of && opts.of.closeUp) info.closeUp = await closeUp(folder, name, n, info, tf, opts.of);
  const tfMs = tf * 60000;
  const [signal, , exit] = info.times || [];
  const long = !!(signal && exit && (exit - signal) / tfMs > (opts.longBars ?? 60));
  if (long) {
    for (const [part, s0, s1] of [['inicio', signal - 8 * tfMs, signal + 40 * tfMs], ['fin', exit - 40 * tfMs, exit + 5 * tfMs]]) {
      const c = await frame(s0, s1, tfMs);
      overlay(c, captionOf(info.detail, part), false);
      cv = document.querySelector('#__audit_overlay canvas');
      if (cv) await post('img', folder, `${name}_${part}`, cv.toDataURL('image/jpeg', 0.86));
    }
    const c = await frame(signal - 8 * tfMs, exit + 5 * tfMs, tfMs);
    overlay(c, captionOf(info.detail, 'completo'), false);
  }
  await post('json', folder, name, info);
  return { n, ready: info.ready, saved, long, head: (info.detail || '').split('\n').slice(0, 3).join(' | '), table: info.table, times: info.times,
           of: [info.of, info.closeUp].filter(Boolean).join(' · ') };
}

function levelsOf(txt) {
  const m = /Entrada ([\d.]+) · stop ([\d.]+) \(([\d.]+) ATR\)(?: · objetivo ([\d.]+))? · salida ([\d.]+)/.exec(txt || '');
  if (!m) return null;
  return { entry: +m[1], stop: +m[2], target: m[4] ? +m[4] : null, exit: +m[5] };
}

function chartStep(arr) {
  // Paso de las velas del gráfico: el menor de las últimas diferencias (un hueco solo las agranda)
  let best = null;
  for (let i = Math.max(1, arr.length - 12); i < arr.length; i++) {
    const d = arr[i].timestamp - arr[i - 1].timestamp;
    if (d > 0 && (best === null || d < best)) best = d;
  }
  return best;
}

const TF_BUTTON = { 1: '1M', 5: '5M', 15: '15M', 60: '1H', 240: '4H' };

async function setChartTf(tfMin) {
  // Pone el gráfico en el marco de la regla con su botón, como el usuario: la ventana solo lo cambia sola si la regla
  // tiene indicadores propios (O-16). Espera a que las velas del gráfico tengan ese paso.
  const label = TF_BUTTON[tfMin];
  if (!label) return `sin botón para ${tfMin} min`;
  const want = tfMin * 60000;
  if (chartStep((chart() || {}).candles || []) === want) return 'ya estaba';
  const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === label);
  if (!btn) return 'sin el botón ' + label;
  btn.click();
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    const c = chart();
    if (c && c.candles && chartStep(c.candles) === want && !/Pidiendo las velas/.test(document.body.innerText)) return 'cambiado a ' + label;
  }
  return '⚠ no cambió a ' + label;
}

function ruleCandles(tfMs) {
  // Etapa 6: las reglas de 30m y 1D no tienen marco en el gráfico; se miran en 15M y 4H y sus velas se arman uniendo
  // las del gráfico por bloques de su marco en UTC (como el motor: 30m de dos de 15m, el día de las de 4h por día UTC)
  const arr = (chart() || {}).candles || [];
  const step = chartStep(arr);
  if (!step || step >= tfMs || tfMs % step) return arr;
  const out = [];
  let cur = null;
  for (const c of arr) {
    const t = Math.floor(c.timestamp / tfMs) * tfMs;
    if (!cur || cur.timestamp !== t) { cur = { timestamp: t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 }; out.push(cur); }
    else { cur.high = Math.max(cur.high, c.high); cur.low = Math.min(cur.low, c.low); cur.close = c.close; cur.volume += c.volume || 0; }
  }
  return out;
}

function autocheck(detail, times, tf, opts = {}) {
  // Comprobación con las velas del gráfico (las oficiales de Bybit, o las del caché en las monedas sin almacén):
  // entrada contra la apertura, ninguna vela antes de la salida toca un nivel, la de la salida toca el suyo, y si
  // es dudosa (toca los dos). Solo informa: en las monedas con almacén el motor usa velas armadas con los trades (H11).
  const lv = levelsOf(detail);
  const [, entryT, exitT] = times || [];
  const tfMs = tf * 60000;
  const arr = ruleCandles(tfMs);
  // Sin comprobar o en otro marco es un aviso (22/11: la cola de delta salió en 4H y contaba como bien)
  if (!lv || !entryT || !exitT || !arr.length) return '⚠ sin comprobar';
  const spacing = chartStep(arr);
  if (spacing && spacing !== tfMs && tf <= 240) return `⚠ el gráfico está en velas de ${spacing / 60000} min y la regla en ${tf}`;
  const side = /· Largo ·/.test(detail) ? 1 : -1;
  const reason = (/^Trade \d+ · \w+ · [^·]+ · (.+)$/m.exec(detail) || [])[1] || '';
  const barOf = (t) => { let lo = 0, hi = arr.length - 1, k = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].timestamp <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; } return k; };
  const i0 = barOf(entryT), i1 = barOf(exitT);
  if (i0 < 0 || i1 < i0 || arr[i0].timestamp + tfMs <= entryT) return '⚠ sin la vela de la entrada en el gráfico';
  // Etapa 6: las velas de las acciones empiezan a las :30 (09:30 de Nueva York): una entrada en la apertura de la vela
  // también está alineada si cae justo en su comienzo
  if (arr[i0].timestamp !== Math.floor(entryT / tfMs) * tfMs && arr[i0].timestamp !== entryT && tf <= 240) return '⚠ el gráfico no está en el marco de la regla';
  const out = [];
  const open = arr[i0].open;
  const dOpen = Math.abs(open - lv.entry);
  if (/\(mercado\)/.test(detail) && entryT === arr[i0].timestamp && !opts.stopEntry) out.push(dOpen === 0 ? 'entrada=apertura' : `entrada ${lv.entry} vs apertura ${open}`);
  if (/\(limit\)/.test(detail)) {
    // La limit se pone al cerrar la vela de la señal y se llena al cruzar su precio (pasar más allá), en 8 velas o menos
    const iSig = barOf(times[0]);
    const iPlace = iSig + 1;
    const cross = (b) => side > 0 ? b.low < lv.entry : b.high > lv.entry;
    const before = [];
    for (let i = iPlace; i < i0; i++) if (cross(arr[i])) before.push(new Date(arr[i].timestamp).toISOString().slice(5, 16));
    const waited = i0 - iPlace;
    const gapOpen = side > 0 ? arr[i0].open < lv.entry : arr[i0].open > lv.entry;
    out.push(`limit llenada en la vela ${waited + 1} de espera` + (cross(arr[i0]) ? ', la vela cruza el precio' : ' ⚠ la vela no cruza el precio')
      + (gapOpen ? ` (abre más allá: apertura ${arr[i0].open})` : '')
      + (before.length ? ` ⚠ ya cruzaba antes: ${before.join(', ')}` : ''));
  }
  const hitS = (b) => side > 0 ? b.low <= lv.stop : b.high >= lv.stop;
  const hitT = (b) => !opts.noTarget && lv.target != null && (side > 0 ? b.high >= lv.target : b.low <= lv.target);
  const early = [];
  const isLimit = /\(limit\)/.test(detail) || !!opts.stopEntry;
  // En la vela del llenado de una limit solo cuenta lo de después del llenado: eso lo dicen los minutos, no la vela
  if (isLimit && i0 < i1 && (hitS(arr[i0]) || hitT(arr[i0]))) out.push('la vela del llenado toca ' + (hitS(arr[i0]) ? 'el stop' : 'el objetivo') + ' (antes o después del llenado: minutos)');
  for (let i = isLimit ? i0 + 1 : i0; i < i1; i++) if (hitS(arr[i]) || hitT(arr[i])) early.push(new Date(arr[i].timestamp).toISOString().slice(5, 16) + (hitS(arr[i]) ? ' stop' : ' obj'));
  if (early.length) out.push('⚠ toca antes de la salida: ' + early.join(', '));
  const b = arr[i1];
  const s = hitS(b), g = hitT(b);
  if (reason.trim() === 'stop') out.push(s ? 'la vela de la salida toca el stop' : `⚠ la vela de la salida no toca el stop (${side > 0 ? 'mín ' + b.low : 'máx ' + b.high})`);
  else if (reason.trim() === 'objetivo') out.push(g ? 'la vela de la salida toca el objetivo' : `⚠ la vela de la salida no toca el objetivo (${side > 0 ? 'máx ' + b.high : 'mín ' + b.low})`);
  else {
    // Otras salidas (stop a la entrada, arrastrado, tiempo, señal contraria...): la vela de la salida contiene su precio
    const inBar = b.low <= lv.exit && lv.exit <= b.high;
    const held = i1 - i0;
    out.push(`salida por ${reason.trim()}: ${inBar ? 'su precio está en la vela' : `⚠ su precio ${lv.exit} no está en la vela (${b.low}–${b.high})`}`
      + (/entrada/.test(reason) ? (Math.abs(lv.exit - lv.entry) < 1e-9 ? ', en la entrada' : ` ⚠ salida ${lv.exit} ≠ entrada ${lv.entry}`) : '')
      + `, ${held} velas después de la entrada`);
  }
  if (s && g) {
    const first = (b.high - b.open) < (b.open - b.low) ? 'high' : 'low';  // Como _minute_path: en un empate, primero el mínimo
    const pathFirst = (side > 0) === (first === 'high') ? 'objetivo' : 'stop';
    const minute = exitT % tfMs !== 0;
    out.push(`dudosa (${minute ? 'minuto a minuto' : 'recorrido supuesto: ' + pathFirst})`);
  }
  return out.join('; ');
}


function swingCheck(detail, times, opts) {
  // El stop en el swing, como _stop_price del motor: el pivote más reciente (único extremo de 2n+1 velas) con sus n velas
  // de la derecha cerradas al cierre de la vela de la señal y detrás de la entrada; hasta 6 pivotes; si no, el extremo de
  // las últimas 4n+1 velas. Más o menos el margen en ATR. Con las velas del gráfico (oficiales en las monedas con almacén).
  const lv = levelsOf(detail);
  const m = /stop [\d.]+ \(([\d.]+) ATR\)/.exec(detail || '');
  const arr = (chart() || {}).candles || [];
  if (!lv || !m || !arr.length || !times || !times[0]) return 'swing sin comprobar';
  const side = /· Largo ·/.test(detail) ? 1 : -1;
  const n = opts.bars ?? 5, buffer = opts.buffer ?? 0.1;
  const atr = (lv.entry - lv.stop) * side / Number(m[1]);
  const implied = lv.stop + side * buffer * atr;
  let k = -1, lo = 0, hi = arr.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].timestamp <= times[0]) { k = mid; lo = mid + 1; } else hi = mid - 1; }
  const vals = arr.map(b => side > 0 ? b.low : b.high);
  const isPivot = (p) => { if (p - n < 0 || p + n >= vals.length) return false; const w = vals.slice(p - n, p + n + 1); const ex = side > 0 ? Math.min(...w) : Math.max(...w); return vals[p] === ex && w.filter(x => x === ex).length === 1; };
  const pivot = (start) => { for (let p = start; p >= Math.max(n, start - 200); p--) if (isPivot(p)) return p; return null; };
  let p = k - n, found = null;
  for (let i = 0; i < 6; i++) { p = pivot(p); if (p === null) break; if ((lv.entry - vals[p]) * side > 0) { found = p; break; } p -= 1; }
  let level, where;
  if (found !== null) { level = vals[found]; where = 'swing del ' + new Date(arr[found].timestamp).toISOString().slice(5, 16); }
  else { const w = vals.slice(Math.max(0, k - 4 * n), k + 1); level = side > 0 ? Math.min(...w) : Math.max(...w); where = 'sin swing detrás: extremo de ' + (4 * n + 1) + ' velas'; }
  const rel = Math.abs(level - implied) / implied;
  return `${where} (${level}) ${rel < 2e-4 ? '= stop ∓ margen' : '⚠ vs ' + implied.toFixed(6) + ' que implica el stop'}`;
}


function stopSourceCheck(detail, times, opts) {
  // ¿De qué velas sale el stop? Nivel que implica el stop (± margen en ATR) contra el extremo de las últimas j+1 velas hasta
  // la de la señal (j = 0..3), y contra el hueco del FVG de la vela de la señal (borde lejano de la zona).
  const lv = levelsOf(detail);
  const m = /stop [\d.]+ \(([\d.]+) ATR\)/.exec(detail || '');
  const arr = (chart() || {}).candles || [];
  if (!lv || !m || !arr.length || !times || !times[0]) return 'origen del stop sin comprobar';
  const side = /· Largo ·/.test(detail) ? 1 : -1;
  const buffer = opts.buffer ?? 0.1;
  const atr = (lv.entry - lv.stop) * side / Number(m[1]);
  const implied = lv.stop + side * buffer * atr;
  let k = -1, lo = 0, hi = arr.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].timestamp <= times[0]) { k = mid; lo = mid + 1; } else hi = mid - 1; }
  const near = (x) => Math.abs(x - implied) / implied < 2e-4;
  const found = [];
  for (let j = 0; j <= 3 && k - j >= 0; j++) {
    const w = arr.slice(k - j, k + 1);
    const ex = side > 0 ? Math.min(...w.map(b => b.low)) : Math.max(...w.map(b => b.high));
    if (near(ex)) { found.push(j === 0 ? 'extremo de la vela de la señal' : `extremo de las ${j + 1} velas hasta la señal`); break; }
  }
  if (k >= 2) {
    const fvgUp = [arr[k - 2].high, arr[k].low], fvgDn = [arr[k].high, arr[k - 2].low];
    const z = (opts.invert ? -side : side) > 0 ? fvgUp : fvgDn;
    const far = side > 0 ? Math.min(...z) : Math.max(...z);
    if (near(far)) found.push('borde lejano del hueco del FVG');
  }
  return found.length ? `stop = ${found.join(' y ')} ∓ margen (${implied.toFixed(6)})` : `⚠ stop sin origen reconocido (nivel ${implied.toFixed(6)})`;
}

function fvgCheck(detail, times, opts) {
  // El FVG nuevo de la vela de la señal en las velas del gráfico: hueco entre la vela y dos antes, en la dirección del
  // elemento (la contraria si la regla va invertida). Su tamaño en ATR con el ATR de Wilder, como fvg_swing.
  const arr = opts.tf ? ruleCandles(opts.tf * 60000) : (chart() || {}).candles || [];
  if (!arr.length || !times || !times[0]) return 'FVG sin comprobar';
  const side = /· Largo ·/.test(detail) ? 1 : -1;
  const dir = opts.invert ? -side : side;
  let k = -1, lo = 0, hi = arr.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].timestamp <= times[0]) { k = mid; lo = mid + 1; } else hi = mid - 1; }
  if (k < 2) return '⚠ sin las dos velas anteriores';
  const gap = dir > 0 ? arr[k].low - arr[k - 2].high : arr[k - 2].low - arr[k].high;
  let out = gap > 0 ? `FVG ${dir > 0 ? 'alcista' : 'bajista'} en la vela de la señal (hueco ${gap.toPrecision(4)})` : `⚠ sin hueco ${dir > 0 ? 'alcista' : 'bajista'} en la vela de la señal (${gap.toPrecision(4)})`;
  if (opts.at && /\(limit\)/.test(detail)) {
    // Precio de la limit: borde del hueco del lado del trade (cercano), la mitad o el borde lejano (simulate: zone[0] + share·ancho)
    const lo = dir > 0 ? arr[k - 2].high : arr[k].high, hi = dir > 0 ? arr[k].low : arr[k - 2].low;
    const share = { near: 1.0, mid: 0.5, far: 0.0 }[opts.at];
    const want = side > 0 ? lo + share * (hi - lo) : hi - share * (hi - lo);
    const lv = levelsOf(detail);
    const ok = lv && Math.abs(lv.entry - want) / want < 2e-4;
    out += ok ? `; limit = ${opts.at} del hueco (${want.toPrecision(6)})` : `; ⚠ limit ${lv && lv.entry} vs ${opts.at} del hueco ${want.toPrecision(6)}`;
  }
  return out;
}

async function shot(folder, n, tf, opts = {}) {
  const r = await shoot(folder, n, tf, opts);
  const t = (r.table || []).map(x => x[0]).join('');
  let chk = '';
  try { chk = autocheck(detailText(), r.times, tf, { ...(opts.straddle || opts.stopOrder ? { stopEntry: true } : {}), ...(opts.tp ? { noTarget: true } : {}) }); if (opts.straddle) chk += '; ' + await straddleCheck(detailText(), r.times, { tf, ...opts.straddle }); if (opts.stopOrder) chk += '; ' + await stopOrderCheck(detailText(), r.times, { tf, ...opts.stopOrder }); if (opts.exit) chk += '; ' + exitCheck(detailText(), r.times, { tf, ...opts.exit }); if (opts.tp) chk += '; ' + tpCheck(detailText(), r.times, { tf, ...opts.tp }); if (opts.swing) chk += '; ' + swingCheck(detailText(), r.times, opts.swing); if (opts.source) chk += '; ' + stopSourceCheck(detailText(), r.times, opts.source); if (opts.fvg) chk += '; ' + fvgCheck(detailText(), r.times, { tf, ...opts.fvg }); if (opts.trail) chk += '; ' + trailCheck(detailText(), r.times, { tf, ...opts.trail }); } catch (e) { chk = 'error de la comprobación: ' + e.message; }
  if (r.of) chk += '; ' + r.of;
  return `${r.ready ? '' : 'NO LISTO '}${r.saved ? '' : 'SIN GUARDAR '}${r.long ? 'LARGO (3 capturas) ' : ''}${r.head} [tabla ${t}] {${chk}}`;
}

async function showPart(folder, n, tf, part) {
  const txt = detailText() || '';
  const [signal, , exit] = parseTimes(txt);
  const tfMs = tf * 60000;
  const [s0, s1] = part === 'inicio' ? [signal - 8 * tfMs, signal + 40 * tfMs] : part === 'fin' ? [exit - 40 * tfMs, exit + 5 * tfMs] : [signal - 8 * tfMs, exit + 5 * tfMs];
  const c = await frame(s0, s1, tfMs);
  overlay(c, captionOf(txt, part), false);
  return part;
}

function bars(t0, t1) {
  // Las velas del gráfico entre dos horas (ms UTC): [hora ISO, o, h, l, c]
  const arr = (chart() || {}).candles || [];
  return arr.filter(v => v.timestamp >= t0 && v.timestamp <= t1).map(v => [new Date(v.timestamp).toISOString().slice(5, 16), v.open, v.high, v.low, v.close]);
}

function trailCheck(detail, times, opts = {}) {
  // El trailing del stop, recalculado con las velas del gráfico como lo hace simulate(): al cerrar cada vela, con el
  // mejor precio desde la entrada (la vela entera, también la del llenado: H4), el stop pasa a trailAtr × ATR de esa
  // vela (media simple de 14 rangos verdaderos) si queda más cerca y la vela cerró más allá; desde breakEven R, a la
  // entrada si la vela cerró a favor; el cierre por tiempo, al cierre de la vela horizon contando la de la entrada.
  // Compara la vela, el motivo y el precio de la salida con los del motor. En las monedas con almacén el motor usa
  // velas armadas con los trades (H11): pueden salir diferencias pequeñas.
  const lv = levelsOf(detail);
  const [, entryT, exitT] = times || [];
  const tfMs = (opts.tf || 240) * 60000;
  const arr = (chart() || {}).candles || [];
  if (!lv || !entryT || !exitT || !arr.length) return 'trailing sin comprobar';
  const side = /· Largo ·/.test(detail) ? 1 : -1;
  const reason = ((/^Trade \d+ · \w+ · [^·]+ · (.+)$/m.exec(detail) || [])[1] || '').trim();
  const barOf = (t) => { let lo = 0, hi = arr.length - 1, k = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].timestamp <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; } return k; };
  // La salida por tiempo lleva la hora del cierre de su vela (la apertura de la siguiente)
  const i0 = barOf(entryT), i1 = barOf(reason === 'tiempo' ? exitT - 1 : exitT);
  if (i0 < 0 || i1 < i0) return 'trailing: sin las velas';
  const tr = (i) => { const b = arr[i], pc = i ? arr[i - 1].close : b.close; return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc)); };
  const atrAt = (j) => { let s = 0, c = 0; for (let i = Math.max(0, j - 13); i <= j; i++) { s += tr(i); c++; } return s / c; };
  const isLimit = /\(limit\)/.test(detail) || !!opts.stopEntry;
  const entry = lv.entry, initial = lv.stop, risk = Math.abs(entry - initial);
  const tAtr = opts.trailAtr ?? 2, tStart = opts.trailStart ?? 0, be = opts.breakEven ?? null, hz = opts.horizon ?? null;
  let stop = initial, mfe = 0, got = null;
  const why = (lvl) => lvl === initial ? 'stop' : (lvl === entry ? 'stop en la entrada' : 'stop arrastrado');
  for (let j = i0; j < arr.length && j < i0 + 600; j++) {
    const b = arr[j];
    if (!(isLimit && j === i0)) {
      const hit = side > 0 ? b.low <= stop : b.high >= stop;
      if (hit) { const px = side > 0 ? Math.min(b.open, stop) : Math.max(b.open, stop); got = { j, reason: why(stop), px }; break; }
    } else if (i1 === i0) { return 'trailing: sale en la vela del llenado (lo deciden los minutos)'; }
    mfe = Math.max(mfe, (side > 0 ? b.high - entry : entry - b.low) / risk);
    if (hz && j - i0 + 1 >= hz) { got = { j, reason: 'tiempo', px: b.close }; break; }
    if (mfe >= tStart) {
      const best = entry + side * mfe * risk;
      const level = best - side * tAtr * atrAt(j);
      if ((level - stop) * side > 0 && (b.close - level) * side > 0) stop = level;
    }
    if (be != null && mfe >= be && (entry - stop) * side > 0 && (b.close - entry) * side > 0) stop = entry;
  }
  if (!got) return 'trailing: el gráfico no da salida';
  const when = new Date(arr[got.j].timestamp).toISOString().slice(5, 16);
  const same = got.j === i1 && got.reason === reason;
  const dpx = Math.abs(got.px - lv.exit) / lv.exit * 100;
  return (same && dpx < 0.3 ? 'trailing igual' : '⚠ trailing distinto') + `: con las velas del gráfico sale ${when} por ${got.reason} en ${+got.px.toFixed(6)}`
    + (same ? '' : ` (el motor: ${new Date(arr[i1].timestamp).toISOString().slice(5, 16)} por ${reason} en ${lv.exit})`)
    + (dpx >= 0.0005 ? `, ${dpx.toFixed(3)}% del precio del motor` : '');
}

const __runCache = {};
function runResult(run) {
  // La corrida guardada (una vez por corrida): zona, precio y vela de cada trade, que el detalle no siempre muestra
  if (!__runCache[run]) __runCache[run] = fetch('/api/tester/result/' + run).then(r => r.json());
  return __runCache[run];
}

async function straddleCheck(detail, times, opts = {}) {
  // Las dos órdenes stop, como _straddle_fill: al cierre de la vela de la señal, una arriba y otra abajo (desde la zona
  // del elemento, o desde el cierre, a offset × ATR de la vela de la señal); se llena la primera que el precio toca
  // (en su precio, o en la apertura si la vela abre más allá) dentro de expiry velas. Con las velas del gráfico.
  const n = +((/^Trade (\d+)/.exec(detail || '') || [])[1]);
  const res = await runResult(opts.run);
  const t = (res.trades || []).find(x => x.n === n);
  if (!t) return 'dos órdenes: sin el trade en la corrida';
  const arr = (chart() || {}).candles || [];
  const barOf = (ts) => { let lo = 0, hi = arr.length - 1, k = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].timestamp <= ts) { k = mid; lo = mid + 1; } else hi = mid - 1; } return k; };
  const iso = (ts) => new Date(ts).toISOString().slice(5, 16);
  const fmt = (x) => +(+x).toFixed(6);
  const iSig = barOf(t.signal), iEnt = barOf(t.entry_t);
  if (iSig < 0 || iEnt < 0) return 'dos órdenes: sin las velas';
  const m = /stop [\d.]+ \(([\d.]+) ATR\)/.exec(detail || '');
  const atr = t.risk / (m ? +m[1] : 1.5);
  const off = (opts.offset ?? 0) * atr;
  const fromZone = (opts.from || 'zone') === 'zone' && Array.isArray(t.zone);
  const up = fromZone ? t.zone[1] + off : arr[iSig].close + off;
  const dn = fromZone ? t.zone[0] - off : arr[iSig].close - off;
  for (let j = iSig + 1; j <= iSig + (opts.expiry ?? 8) && j < arr.length; j++) {
    const b = arr[j];
    const hu = b.high >= up, hd = b.low <= dn;
    if (!hu && !hd) continue;
    if (hu && hd) return `dos órdenes: arriba ${fmt(up)} y abajo ${fmt(dn)}; las dos se tocan en la vela ${iso(b.timestamp)} (deciden los minutos o el recorrido supuesto); el motor: ${t.dir > 0 ? 'la de arriba' : 'la de abajo'} en ${fmt(t.entry)}` + (j === iEnt ? '' : ` ⚠ el motor entra en la vela ${iso(arr[iEnt].timestamp)}`);
    const sd = hu ? 1 : -1;
    const gapped = sd > 0 ? b.open > up : b.open < dn;
    const px = gapped ? b.open : (sd > 0 ? up : dn);
    const ok = sd === t.dir && j === iEnt && Math.abs(px - t.entry) / t.entry < 0.002;
    return (ok ? 'dos órdenes igual' : '⚠ dos órdenes distinto') + `: arriba ${fmt(up)} y abajo ${fmt(dn)}; primero ${sd > 0 ? 'la de arriba' : 'la de abajo'}, vela ${iso(b.timestamp)}${gapped ? ' (abre más allá: en la apertura)' : ''}, en ${fmt(px)}`
      + (j - iSig > 1 ? `, tras ${j - iSig - 1} velas de espera` : '')
      + (ok ? '' : `; el motor: ${t.dir > 0 ? 'la de arriba' : 'la de abajo'} en ${fmt(t.entry)}, vela ${iso(arr[iEnt].timestamp)}`)
      + (t.order !== 'stop' ? ` ⚠ el trade dice order ${t.order}` : '');
  }
  return `⚠ dos órdenes: arriba ${fmt(up)} y abajo ${fmt(dn)}; ninguna se toca en ${opts.expiry ?? 8} velas del gráfico`;
}

async function stopOrderCheck(detail, times, opts = {}) {
  // La orden stop de un lado, como _stop_fill: al cierre de la vela de la señal, en el borde de la zona a favor más
  // offset × ATR de la vela de la señal (sin zona, desde el cierre); se llena al tocarla (en la apertura si la vela abre
  // más allá); con cancel se cancela si antes el precio pasa el otro borde de la zona. Espera las velas de la regla o
  // las del elemento (el 3.er sabio). Con las velas del gráfico.
  const n = +((/^Trade (\d+)/.exec(detail || '') || [])[1]);
  const res = await runResult(opts.run);
  const t = (res.trades || []).find(x => x.n === n);
  if (!t) return 'orden stop: sin el trade en la corrida';
  const arr = (chart() || {}).candles || [];
  const barOf = (ts) => { let lo = 0, hi = arr.length - 1, k = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].timestamp <= ts) { k = mid; lo = mid + 1; } else hi = mid - 1; } return k; };
  const iso = (ts) => new Date(ts).toISOString().slice(5, 16);
  const fmt = (x) => +(+x).toFixed(6);
  const iSig = barOf(t.signal), iEnt = barOf(t.entry_t);
  if (iSig < 0 || iEnt < 0) return 'orden stop: sin las velas';
  const m = /stop [\d.]+ \(([\d.]+) ATR\)/.exec(detail || '');
  const atr = t.risk / (m ? +m[1] : 1.5);
  const side = t.dir, z = Array.isArray(t.zone) ? t.zone : null;
  const off = (opts.offset ?? 0) * atr;
  const level = z ? (side > 0 ? z[1] : z[0]) + side * off : arr[iSig].close + side * off;
  const cancel = z && opts.cancel !== false && z[1] > z[0] ? (side > 0 ? z[0] : z[1]) : null;
  for (let j = iSig + 1; j < arr.length && j <= iSig + 600; j++) {
    const b = arr[j];
    const hit = side > 0 ? b.high >= level : b.low <= level;
    const broke = cancel != null && (side > 0 ? b.low < cancel : b.high > cancel);
    if (!hit) {
      if (broke) return `⚠ orden stop: en ${fmt(level)}; se cancela en la vela ${iso(b.timestamp)} (pasa el otro borde, ${fmt(cancel)}) antes de tocarse; el motor entra en la vela ${iso(arr[iEnt].timestamp)} en ${fmt(t.entry)}`;
      continue;
    }
    const waited = j - iSig - 1;
    const gapped = side > 0 ? b.open > level : b.open < level;
    const px = gapped ? b.open : level;
    const ok = j === iEnt && Math.abs(px - t.entry) / t.entry < 0.002;
    return (ok ? 'orden stop igual' : '⚠ orden stop distinta') + `: en ${fmt(level)}` + (cancel != null ? `, se cancela al pasar ${fmt(cancel)}` : '')
      + `; se toca en la vela ${iso(b.timestamp)}, tras ${waited} velas de espera` + (waited + 1 > (opts.expiry ?? 5) ? ` (más que las ${opts.expiry ?? 5} de la regla: la espera del elemento)` : '')
      + (gapped ? ' (abre más allá: en la apertura)' : '') + (broke ? '; esa vela también pasa el otro borde (minutos)' : '')
      + (ok ? '' : `; el motor: vela ${iso(arr[iEnt].timestamp)} en ${fmt(t.entry)}`) + (t.order !== 'stop' ? ` ⚠ el trade dice order ${t.order}` : '');
  }
  return `⚠ orden stop: en ${fmt(level)}; no se toca en las velas del gráfico`;
}

function exitCheck(detail, times, opts = {}) {
  // La salida, como simulate() con las velas del gráfico: en cada vela, el stop vigente y el objetivo (los dos en la
  // misma vela, o el stop en la vela del llenado de una limit u orden stop: lo deciden los minutos; el objetivo solo en
  // la vela del llenado se deja para la siguiente); un stop saltado sale en la apertura. Al cierre: señal contraria
  // (FVG del lado contrario: sale en la apertura siguiente), cierre por tiempo, trailing (atr, pct, swing, bars) y stop
  // a la entrada. Compara vela, motivo y precio con el motor. H11: velas oficiales contra las armadas con los trades.
  // opts.vpa: la salida VPA con el mapa de avisos de vpa.js (vpa_exit_check.mjs), armada desde fromR a favor.
  const lv = levelsOf(detail);
  const [sigT, entryT, exitT] = times || [];
  const tfMs = (opts.tf || 240) * 60000;
  const arr = (chart() || {}).candles || [];
  if (!lv || !entryT || !exitT || !arr.length) return 'salida sin comprobar';
  const side = /· Largo ·/.test(detail) ? 1 : -1;
  const reason = ((/^Trade \d+ · \w+ · [^·]+ · (.+)$/m.exec(detail) || [])[1] || '').trim();
  const barOf = (t) => { let lo = 0, hi = arr.length - 1, k = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].timestamp <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; } return k; };
  const iso = (t) => new Date(t).toISOString().slice(5, 16);
  const tr = (i) => { const b = arr[i], pc = i ? arr[i - 1].close : b.close; return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc)); };
  const atrAt = (j) => { let s = 0, c = 0; for (let i = Math.max(0, j - 13); i <= j; i++) { s += tr(i); c++; } return s / c; };
  const wil = []; for (let i = 0; i < arr.length; i++) wil.push(i === 0 ? tr(0) : (wil[i - 1] * 13 + tr(i)) / 14);  // ATR de Wilder (el del FVG)
  const k = barOf(sigT), i0 = barOf(entryT);
  const i1 = barOf(/tiempo|señal contraria|sale del canal|VPA/.test(reason) ? exitT - 1 : exitT);
  if (k < 0 || i0 < 0 || i1 < i0) return 'salida: sin las velas';
  const fillOrder = /\(limit\)/.test(detail) || !!opts.stopEntry;
  const entry = lv.entry, initial = lv.stop, risk = Math.abs(entry - initial), goal = lv.target;
  const why = (lvl) => lvl === initial ? 'stop' : (lvl === entry ? 'stop en la entrada' : 'stop arrastrado');
  const L = (i) => arr[i].low, H = (i) => arr[i].high;
  const isPivot = (vals, v, sgn) => { const ext = sgn > 0 ? Math.min(...vals) : Math.max(...vals); return v === ext && vals.filter(x => x === ext).length === 1; };
  const oppFvg = (j) => {  // FVG nuevo del lado contrario al trade, conocido al cierre de la vela j
    if (j < 2) return false;
    const gap = -side > 0 ? arr[j].low - arr[j - 2].high : arr[j - 2].low - arr[j].high;
    return gap > 0 && gap >= (opts.fvgMinAtr ?? 0.3) * wil[j];
  };
  let stop = initial, mfe = 0, got = null;
  for (let j = i0; j < arr.length && j < i0 + 800; j++) {
    const b = arr[j], first = j === i0 && fillOrder;
    let hs = side > 0 ? b.low <= stop : b.high >= stop;
    let hg = goal != null && (side > 0 ? b.high >= goal : b.low <= goal);
    if (hs && (hg || first)) { got = { j, reason: 'dudosa', px: null }; break; }
    if (first && hg) hg = false;
    if (hs) { const gapped = side > 0 ? b.open < stop : b.open > stop; got = { j, reason: why(stop), px: gapped && !first ? b.open : stop }; break; }
    if (hg) { got = { j, reason: 'objetivo', px: goal }; break; }
    mfe = Math.max(mfe, (side > 0 ? b.high - entry : entry - b.low) / risk);
    if (opts.opposite && j > k && j + 1 < arr.length && oppFvg(j)) { got = { j, reason: 'señal contraria', px: arr[j + 1].open }; break; }
    if (opts.vpa && j > k && j + 1 < arr.length) {  // salida VPA: aviso en contra al cierre de j (mapa armado con vpa.js sobre las velas del motor)
      const w = ((opts.vpa.map || {})[side] || {})[arr[j].timestamp];
      if (w && mfe >= (opts.vpa.fromR || 0)) { got = { j, reason: w, px: arr[j + 1].open }; break; }
    }
    if (opts.horizon && j - i0 + 1 >= opts.horizon) { got = { j, reason: 'tiempo', px: b.close }; break; }
    const t = opts.trail || 'none', m = opts.trailBars ?? 5, buf = opts.buffer ?? 0.1;
    if (t === 'swing') {
      const p = j - m;
      if (p - m >= 0 && p > k) {
        const vals = []; for (let i = p - m; i <= j; i++) vals.push(side > 0 ? L(i) : H(i));
        const v = side > 0 ? L(p) : H(p);
        const level = v - side * buf * atrAt(j);
        if (isPivot(vals, v, side) && (level - stop) * side > 0 && (b.close - level) * side > 0) stop = level;
      }
    } else if (t === 'bars' && j >= i0) {
      const vals = []; for (let i = Math.max(0, j - m + 1); i <= j; i++) vals.push(side > 0 ? L(i) : H(i));
      const level = (side > 0 ? Math.min(...vals) : Math.max(...vals)) - side * buf * atrAt(j);
      if ((level - stop) * side > 0 && (b.close - level) * side > 0) stop = level;
    } else if ((t === 'atr' || t === 'pct') && mfe >= (opts.trailStart ?? 0)) {
      const best = entry + side * mfe * risk;
      const gap = t === 'atr' ? (opts.trailAtr ?? 3) * atrAt(j) : best * (opts.trailPct ?? 2) / 100;
      const level = best - side * gap;
      if ((level - stop) * side > 0 && (b.close - level) * side > 0) stop = level;
    }
    if (opts.breakEven != null && mfe >= opts.breakEven && (entry - stop) * side > 0 && (b.close - entry) * side > 0) stop = entry;
  }
  if (!got) return 'salida: el gráfico no da salida';
  if (got.reason === 'dudosa') return `salida: vela dudosa ${iso(arr[got.j].timestamp)} (minutos); el motor: ${iso(arr[i1].timestamp)} por ${reason}` + (got.j === i1 ? '' : ' ⚠ otra vela');
  const same = got.j === i1 && got.reason === reason;
  const dpx = Math.abs(got.px - lv.exit) / lv.exit * 100;
  return (same && dpx < 0.3 ? 'salida igual' : '⚠ salida distinta') + `: con las velas del gráfico ${iso(arr[got.j].timestamp)} por ${got.reason} en ${+got.px.toFixed(6)}`
    + (same ? '' : ` (el motor: ${iso(arr[i1].timestamp)} por ${reason} en ${lv.exit})`)
    + (dpx >= 0.0005 && same ? `, ${dpx.toFixed(3)}% del precio del motor` : '');
}

function tpCheck(detail, times, opts = {}) {
  // Objetivo arrastrado (exit.tpTrail), comprobación gruesa con las velas del gráfico (el motor lo mira minuto a minuto;
  // la comprobación exacta es la capa A con los minutos del almacén). Arranque = entrada + start·R. Distancia: R del
  // trade, ATR de la vela de la señal (riesgo / ATR del stop) o % del mejor precio. Comprueba: la vela en que el precio
  // llega al arranque; que la salida por objetivo arrastrado esté entre el nivel con el mejor precio en el arranque y el
  // nivel con el mejor extremo de las velas desde el arranque hasta la salida (o la apertura si la vela salta); que la
  // vela de la salida toque su precio; y que el stop no se toque antes.
  const lv = levelsOf(detail);
  const [, entryT, exitT] = times || [];
  const arr = (chart() || {}).candles || [];
  if (!lv || !entryT || !exitT || !arr.length) return 'objetivo arrastrado sin comprobar';
  const side = /· Largo ·/.test(detail) ? 1 : -1;
  const reason = ((/^Trade \d+ · \w+ · [^·]+ · (.+)$/m.exec(detail) || [])[1] || '').trim();
  const barOf = (t) => { let lo = 0, hi = arr.length - 1, k = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].timestamp <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; } return k; };
  const iso = (t) => new Date(t).toISOString().slice(5, 16);
  const fmt = (x) => +(+x).toFixed(6);
  const i0 = barOf(entryT), i1 = barOf(exitT);
  if (i0 < 0 || i1 < i0) return 'objetivo arrastrado: sin las velas';
  const risk = Math.abs(lv.entry - lv.stop);
  const atrM = /stop [\d.]+ \(([\d.]+) ATR\)/.exec(detail || '');
  const atr = risk / (atrM ? +atrM[1] : (opts.stopAtr ?? 1.5));
  const startR = Math.min(opts.start, opts.targetR ?? opts.start);
  const start = lv.entry + side * startR * risk;
  const dist = (best) => opts.unit === 'r' ? opts.dist * risk : (opts.unit === 'atr' ? opts.dist * atr : best * opts.dist / 100);
  const reach = (b) => side > 0 ? b.high >= start : b.low <= start;
  let ja = -1;
  for (let j = i0; j <= i1; j++) if (reach(arr[j])) { ja = j; break; }
  if (reason !== 'objetivo arrastrado') return ja < 0 ? `objetivo arrastrado: no llega al arranque (${fmt(start)}); sale por ${reason}` : `objetivo arrastrado: llega al arranque (${fmt(start)}) en la vela ${iso(arr[ja].timestamp)} y sale por ${reason}`;
  if (ja < 0) return `⚠ salida por objetivo arrastrado sin llegar al arranque (${fmt(start)})`;
  let best = side > 0 ? -Infinity : Infinity;
  for (let j = ja; j <= i1; j++) best = side > 0 ? Math.max(best, arr[j].high) : Math.min(best, arr[j].low);
  const hiLevel = best - side * dist(best);            // con el mejor extremo de las velas: lo más a favor posible
  const loLevel = start - side * dist(start);          // con el mejor precio en el arranque: lo menos a favor
  const b = arr[i1], eps = Math.max(1e-9, lv.exit * 2e-4);
  const floor = side > 0 ? Math.min(loLevel, b.open) : Math.max(loLevel, b.open);
  const inRange = side > 0 ? (lv.exit <= hiLevel + eps && lv.exit >= floor - eps) : (lv.exit >= hiLevel - eps && lv.exit <= floor + eps);
  const touched = side > 0 ? b.low <= lv.exit + eps : b.high >= lv.exit - eps;
  const sameBar = ja === i1;
  return `objetivo arrastrado: llega al arranque (${fmt(start)}) en la vela ${iso(arr[ja].timestamp)}` + (sameBar ? ' (la misma de la salida)' : `, ${i1 - ja} velas antes de la salida`)
    + `; sale en ${lv.exit} ` + (inRange ? `dentro de lo posible (${fmt(Math.min(loLevel, hiLevel))}–${fmt(Math.max(loLevel, hiLevel))})` : `⚠ fuera de lo posible (${fmt(Math.min(loLevel, hiLevel))}–${fmt(Math.max(loLevel, hiLevel))})`)
    + (touched ? '' : ' ⚠ la vela de la salida no toca ese precio');
}

async function batch(name, from, to, tf, opts = {}) {
  // Varios trades seguidos con shot() (cada uno guarda su captura y su JSON). Devuelve una línea por trade: lado, R y
  // motivo, y "ok", o ⚠ con la comprobación completa si algo no cuadra (⚠, ✗ o la tabla sin ✓).
  const out = [];
  for (let n = from; n <= to; n++) {
    let s;
    try { s = await shot(name, n, tf, opts); } catch (e) { out.push(`#${n} ⚠ error: ${e && e.message}`); continue; }
    s = String(s || '');
    const head = /Trade \d+ · (\w+) · ([^·]+) · ([^|]+)\|/.exec(s) || [];
    const bad = /⚠|✗|NO LISTO|SIN GUARDAR/.test(s) || !/tabla ✓/.test(s);
    out.push(`#${n} ${head[1] || '?'} ${(head[2] || '').trim()} ${(head[3] || '').trim()}` + (bad ? ` ⚠ ${s.slice(s.indexOf('|') + 1)}` : ' ok'));
  }
  return out.join('\n');
}

function appLoadRun() {
  // El loadRun de la ventana (un useCallback de RuleTesterApp): abre una corrida por su id, como "Ver" en el Historial o
  // el &run= de la dirección. Galería (25/11): el Historial lista solo las 200 corridas más recientes de la moneda, y las
  // de la galería del 22/11 ya quedaron fuera
  for (let f = fiberOf(document.querySelector('button')); f; f = f.return) {
    if (typeof f.type !== 'function') continue;
    for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
      const s = h.memoizedState;
      const src = Array.isArray(s) && typeof s[0] === 'function' ? String(s[0]) : '';
      if (/tester\/result\/\$\{id\}/.test(src) && /setResults/.test(src) && /setTab\(['"]resumen['"]\)/.test(src)) return s[0];
    }
  }
  return null;
}

async function openRun(run) {
  // Abre una corrida guardada como el botón "Ver" de su fila en el Historial (la clave React de la fila es su id) y
  // espera a que la lista de trades sea la suya: el trade 1 de la página tiene la vela de la señal del trade 1 guardado.
  const res = await runResult(run);
  const first = (res.trades || [])[0];
  const tab = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Historial');
  if (tab) tab.click();
  let row = null;
  for (let i = 0; i < 80 && !row; i++) {
    await sleep(250);
    row = [...document.querySelectorAll('tr')].find(tr => { const f = fiberOf(tr); return f && f.key === run; });
  }
  if (row) [...row.querySelectorAll('button')].find(b => b.innerText.trim() === 'Ver').click();
  else {
    const load = appLoadRun();
    if (!load) throw new Error('No está la corrida ' + run + ' en el Historial');
    await load(run);
  }
  await sleep(1500);
  await ready();
  // Fases 2 y 3 (etapa 5): el gráfico queda tapado hasta pedirlo, y sin él no se dibujan las cajas ni se va al trade
  const reveal = [...document.querySelectorAll('button')].find(b => /^Ver el gráfico de la fase \d$/.test(b.innerText.trim()));
  if (reveal) { reveal.click(); await sleep(1000); }
  if (!first) return { trades: 0 };
  const tfMin = (res.rule && res.rule.tf) || 240;
  const tfMs = tfMin * 60000;
  // Etapa 6 (reparto): al abrir otra vez la corrida que ya estaba abierta, ready() ve la lista vieja y sigue; cuando la
  // carga termina la página vuelve al Resumen y la fila 1 desaparece ("No está la fila del trade 1"). Se reintenta
  // esperando otra vez la lista (ready() vuelve a pulsar "Trades").
  let lastError = null;
  for (let tries = 0; tries < 6; tries++) {
    try {
      if (await select(1)) {
        const t0 = parseTimes(detailText() || '')[0];
        if (t0 && Math.floor(t0 / tfMs) === Math.floor(first.signal / tfMs)) return { trades: res.trades.length, tf: tfMin };
      }
    } catch (e) { lastError = e; }
    await sleep(2000);
    await ready();
  }
  throw lastError || new Error('La lista de la página no es la de ' + run);
}

async function waitViewport(q, st) {
  // Etapa 6: una pestaña abierta con el panel del navegador oculto mide 0×0 y solo tiene tamaño mientras dura la
  // emulación, que se borra al terminar cada turno de Claude. Sin tamaño, el gráfico no dibuja: se espera a que vuelva.
  if (window.innerWidth >= 200 && window.innerHeight >= 200) return;
  if (st) st.waiting = Date.now();
  while ((window.innerWidth < 200 || window.innerHeight < 200) && !q.stop) await sleep(5000);
  if (st) st.waiting = null;
  await sleep(3000);  // que el gráfico vuelva a medirse
}

async function runItem(q, it, st, beat) {
  // Un elemento de una cola o un tramo del reparto: abre la corrida desde el Historial y revisa sus trades con shot();
  // sus líneas se guardan en el receptor cada 2 minutos y al terminar (pantalla/<name>/<linesName>.json).
  // it.from / it.to: un tramo de los trades (para repartir una corrida larga entre pestañas o repetir uno);
  // it.only: solo esos números (repeticiones sueltas); it.linesName: otro archivo de líneas, para que dos pestañas no
  // escriban el mismo
  let saved = Date.now();
  const save = () => post('json', it.name, it.linesName || 'lineas', { run: it.run, from: it.from || 1, to: it.to || null, lines: st.lines, done: st.done }).catch(() => {});
  try {
    await waitViewport(q, st);
    const got = await openRun(it.run);
    st.N = it.to ? Math.min(got.trades, it.to) : got.trades;
    const tf = got.tf || it.tf || 240;
    // 30m y 1D no tienen botón: el gráfico va en 15M y 4H, y las comprobaciones unen sus velas (ruleCandles)
    st.tf = await setChartTf(TF_BUTTON[tf] ? tf : (it.chartTf || (tf === 30 ? 15 : tf === 1440 ? 240 : tf)));
    if (/⚠/.test(st.tf)) throw new Error('el gráfico no quedó en el marco de la regla: ' + st.tf);
    const opts = { ...(it.opts || {}) };
    if (opts.straddle) opts.straddle = { run: it.run, ...opts.straddle };
    const numbers = it.only ? it.only.filter(n => n <= st.N) : null;
    for (let k = 0, n = numbers ? numbers[0] : (it.from || 1); numbers ? k < numbers.length : n <= st.N; k++, n = numbers ? numbers[k] : n + 1) {
      st.n = n;
      if (q.stop) break;
      await waitViewport(q, st);
      if (q.stop) break;
      let s;
      try {
        for (let tries = 0; tries < 200 && !rows().some(r => r.cells[0].textContent.trim() === String(n)); tries++) {
          const more = [...document.querySelectorAll('button')].find(b => /Mostrar \d+ más/.test(b.innerText));
          if (!more) break;
          more.click(); await sleep(1500);
        }
        s = await shot(it.name, n, tf, opts);
      } catch (e) { st.lines.push(`#${n} ⚠ error: ${e && e.message}`); continue; }
      s = String(s || '');
      const head = /Trade \d+ · (\w+) · ([^·]+) · ([^|]+)\|/.exec(s) || [];
      const bad = /⚠|✗|NO LISTO|SIN GUARDAR/.test(s) || !/tabla ✓/.test(s);
      st.lines.push(`#${n} ${head[1] || '?'} ${(head[2] || '').trim()} ${(head[3] || '').trim()}` + (bad ? ` ⚠ ${s.slice(s.indexOf('|') + 1)}` : ' ok'));
      st.last = n;
      if (Date.now() - saved > 120000) { saved = Date.now(); save(); if (beat) beat(st); }
    }
  } catch (e) { st.lines.push(`⚠ no se pudo abrir: ${e && e.message}`); st.failed = String(e && e.message); }
  st.done = true; st.ended = Date.now();
  await save();
}

function queue(items) {
  // Cola de corridas de una pestaña: [{name, run, opts, from, to, only, linesName}], una tras otra (runItem)
  if (window.__q && !window.__q.done) return 'ya corre: ' + window.__q.items[window.__q.i].name;
  const q = window.__q = { items, i: 0, done: false, started: Date.now(), runs: {}, read: {} };
  (async () => {
    for (q.i = 0; q.i < items.length; q.i++) {
      const it = items[q.i];
      const st = q.runs[it.name] = { n: 0, N: null, lines: [], started: Date.now(), done: false };
      await runItem(q, it, st);
      if (q.stop) break;
    }
    q.done = true; q.ended = Date.now();
  })();
  return 'empezó la cola: ' + items.map(x => x.name).join(', ');
}

// Reparto común (etapa 6): una lista de tramos en el localStorage de la página aislada (127.0.0.1:9301), tomada por
// todas las pestañas con un candado del navegador (navigator.locks, atómico entre pestañas del mismo origen). El
// backend guarda en memoria las 3 últimas corridas repetidas para el contexto del trade (rule_tester._replay): con más
// corridas distintas a la vez repite la regla entera en casi cada trade. Por eso una pestaña toma primero un tramo de
// una corrida que ya está en curso, y una corrida nueva solo si hay menos de `maxRuns` en curso.
const WORK_KEY = '__audit_work';
const workLoad = () => { try { return JSON.parse(localStorage.getItem(WORK_KEY)) || null; } catch (e) { return null; } };
const workSave = (w) => localStorage.setItem(WORK_KEY, JSON.stringify(w));
const withWork = (fn) => navigator.locks.request('audit-work', async () => { const w = workLoad(); const out = w ? fn(w) : null; if (w) workSave(w); return out; });

function workInit(chunks, maxRuns = 3) {
  // chunks: [{name, run, sym, opts, from, to, only}] en el orden en que se quieren; cada uno escribe su propio archivo
  // de líneas (lineas_w<id>)
  const w = { maxRuns, created: Date.now(), chunks: chunks.map((c, i) => ({ id: i + 1, state: 'todo', ...c, linesName: c.linesName || `lineas_w${i + 1}` })) };
  return navigator.locks.request('audit-work', async () => { workSave(w); return `reparto con ${w.chunks.length} tramos`; });
}

function workTake(tab, sym) {
  return withWork((w) => {
    const now = Date.now();
    // Un tramo tomado por una pestaña que no avisa hace 25 minutos vuelve a la lista, desde su último trade hecho
    for (const c of w.chunks) {
      if (c.state === 'taken' && now - (c.beat || c.taken) > 25 * 60000) { c.state = 'todo'; c.lost = (c.lost || 0) + 1; c.tab = null; }
    }
    const active = new Set(w.chunks.filter(c => c.state === 'taken').map(c => c.run));
    const mine = w.chunks.filter(c => c.state === 'todo' && c.sym === sym);
    let pick = mine.find(c => active.has(c.run));
    if (!pick && active.size < (w.maxRuns || 3)) pick = mine[0];
    if (!pick) return mine.length ? 'wait' : null;
    Object.assign(pick, { state: 'taken', tab, taken: now, beat: now });
    return { ...pick };
  });
}

function worker(tab) {
  // La pestaña toma tramos de su moneda hasta que no quedan. __w.stop = true la detiene tras el trade en curso, y el
  // resto de su tramo vuelve a la lista.
  if (window.__w && !window.__w.done) return 'ya trabaja: ' + (window.__w.cur && window.__w.cur.name);
  const sym = new URLSearchParams(location.search).get('symbol');
  const w = window.__w = { tab, sym, done: false, stop: false, started: Date.now(), runs: {}, read: {}, items: [], cur: null };
  (async () => {
    while (!w.stop) {
      const c = await workTake(tab, sym);
      if (c === null) break;
      if (c === 'wait') { await sleep(20000); continue; }
      w.cur = c;
      w.items.push({ name: `${c.name}#${c.id}` });
      const st = w.runs[`${c.name}#${c.id}`] = { n: 0, N: null, lines: [], started: Date.now(), done: false };
      await runItem(w, c, st, () => withWork((all) => { const x = all.chunks.find(y => y.id === c.id); if (x) x.beat = Date.now(); }));
      const warn = st.lines.filter(l => /⚠/.test(l)).length;
      await withWork((all) => {
        const x = all.chunks.find(y => y.id === c.id);
        if (!x) return;
        const finished = c.only ? st.last === c.only[c.only.length - 1] : st.last !== undefined && st.last >= (st.N || 0);
        if (w.stop && !st.failed && !finished) {
          // Detenida a mitad: sin ningún trade hecho el tramo vuelve entero; si no, lo que falta va como otro tramo
          if (st.last === undefined) { Object.assign(x, { state: 'todo', tab: null, taken: null, beat: null }); return; }
          const id = Math.max(...all.chunks.map(y => y.id)) + 1;
          const rest = { ...x, id, state: 'todo', tab: null, taken: null, beat: null, linesName: `lineas_w${id}` };
          if (c.only) rest.only = c.only.slice(c.only.indexOf(st.last) + 1); else rest.from = st.last + 1;
          all.chunks.push(rest);
        }
        Object.assign(x, { state: st.failed ? 'failed' : 'done', ended: Date.now(), shots: st.lines.length, warn, failed: st.failed || null });
      });
      w.cur = null;
      await post('json', '_reparto', 'estado', workLoad()).catch(() => {});
    }
    w.done = true; w.ended = Date.now();
    await post('json', '_reparto', 'estado', workLoad()).catch(() => {});
  })();
  return 'trabaja en ' + sym;
}

function workStatus() {
  // Resumen del reparto: tramos por estado y, por corrida, cuántos van
  const w = workLoad();
  if (!w) return 'sin reparto';
  const by = {};
  for (const c of w.chunks) by[c.state] = (by[c.state] || 0) + 1;
  const taken = w.chunks.filter(c => c.state === 'taken').map(c => `${c.tab}: ${c.name} ${c.only ? '[' + c.only.length + ' sueltos]' : (c.from || 1) + '-' + (c.to || '')}`);
  const failed = w.chunks.filter(c => c.state === 'failed').map(c => `${c.name}#${c.id}: ${c.failed}`);
  const warn = w.chunks.reduce((s, c) => s + (c.warn || 0), 0);
  return JSON.stringify({ ...by, avisos: warn, enCurso: taken, fallidos: failed });
}

function qRead() {
  // Lo nuevo de la cola desde la lectura anterior: por corrida, cuántas van, las que están bien y las que tienen aviso
  const q = window.__q;
  if (!q) return 'nada';
  const out = [];
  for (const it of q.items) {
    const st = q.runs[it.name];
    if (!st) continue;
    const from = q.read[it.name] || 0;
    const nuevas = st.lines.slice(from);
    q.read[it.name] = st.lines.length;
    const bad = nuevas.filter(l => /⚠/.test(l));
    if (!nuevas.length && st.done) continue;
    out.push(`${it.name} · ${st.lines.length}/${st.N ?? '?'} · ${st.done ? 'terminó' : 'va en ' + st.n} · ${Math.round(((st.ended || Date.now()) - st.started) / 1000)} s · nuevas ${nuevas.length}, ok ${nuevas.filter(l => / ok$/.test(l)).length}, con aviso ${bad.length}`
      + (bad.length ? '\n' + bad.slice(0, 15).join('\n') + (bad.length > 15 ? `\n… y ${bad.length - 15} más` : '') : ''));
  }
  return (q.done ? 'cola terminada · ' : `cola en ${q.i + 1}/${q.items.length} · `) + Math.round(((q.ended || Date.now()) - q.started) / 1000) + ' s\n' + out.join('\n');
}

window.__audit = { chart, rows, detailText, signalTable, ready, select, frame, overlay, clear, prepare, parseTimes, post, shoot, shot, showPart, bars, autocheck, levelsOf, swingCheck, stopSourceCheck, fvgCheck, trailCheck, straddleCheck, stopOrderCheck, exitCheck, tpCheck, batch, runResult, openRun, queue, qRead, setChartTf, chartStep, workInit, workTake, worker, workStatus, workLoad };
export default window.__audit;
