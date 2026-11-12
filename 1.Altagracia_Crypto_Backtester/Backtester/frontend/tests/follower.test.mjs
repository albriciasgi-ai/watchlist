// Hora que muestra el segundo gráfico: sigue a la principal sin adelantarse y sin saltos.
// Uso: node tests/follower.test.mjs
import assert from 'node:assert/strict';
import { createFollower, createSourcePicker, MINUTE_MS } from '../src/components/backtesting/replayFollower.js';
import { reportOf, replayBasics, sameBasics, stepTimeframes } from '../src/components/backtesting/replayChannel.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);

const FRAME = 1000 / 60;
const START = Date.UTC(2026, 9, 20, 5, 0, 0);

/** Azar repetible, para que una falla se pueda volver a correr */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Reproduce una sesión: informes de la principal en "reports" [{ at, time, playing, speed }] y un cuadro
 * cada "frameMs". Devuelve lo mostrado en cada cuadro y revisa en todos que no se adelante a la principal
 */
function simulate(reports, { until, frameMs = FRAME, follower = createFollower(), frameGaps = null } = {}) {
  const frames = [];
  let next = 0;
  let reported = null;
  let frameIndex = 0;
  for (let now = 0; now <= until; now += frameGaps ? frameGaps(frameIndex++) : frameMs) {
    while (next < reports.length && reports[next].at <= now) {
      const { at, ...clock } = reports[next++];
      follower.report(clock, at);
      reported = clock.time;
    }
    const shown = follower.frame(now);
    if (shown !== null) {
      assert.ok(shown <= reported, `a los ${now.toFixed(0)} ms muestra ${shown - reported} ms después de la principal`);
      frames.push({ now, shown, reported });
    }
  }
  return { frames, follower };
}

/** Informes de una reproducción continua: cada "everyMs" reales, a "speed" */
function steadyReports({ speed, everyMs, seconds, startAt = 0, startTime = START }) {
  const reports = [];
  for (let at = startAt; at <= startAt + seconds * 1000; at += everyMs) {
    const time = startTime + Math.floor(((at - startAt) * speed) / MINUTE_MS) * MINUTE_MS;
    reports.push({ at, time, playing: true, speed });
  }
  return reports;
}

const steps = (frames) => frames.slice(1).map((frame, i) => frame.shown - frames[i].shown);

test('sin informes no hay hora que mostrar', () => {
  const follower = createFollower();
  assert.equal(follower.frame(0), null);
  assert.equal(follower.pending(), false);
});

test('el primer informe se muestra tal cual', () => {
  const follower = createFollower();
  follower.report({ time: START, playing: false, speed: 1 }, 10);
  assert.equal(follower.frame(20), START);
  assert.equal(follower.pending(), false);
});

test('en pausa cada informe se muestra de inmediato, también un salto de días', () => {
  const follower = createFollower();
  follower.report({ time: START, playing: false, speed: 10000 }, 0);
  follower.report({ time: START + 3 * 86400000, playing: false, speed: 10000 }, 5);
  assert.equal(follower.frame(6), START + 3 * 86400000);
});

test('un informe por minuto se muestra sin atraso', () => {
  // 1000x con pasos de 1 minuto: un informe cada 60 ms
  const reports = steadyReports({ speed: 1000, everyMs: 60, seconds: 3 });
  const { frames } = simulate(reports, { until: 3000 });
  for (const frame of frames) assert.equal(frame.shown, frame.reported, 'va con la principal en cada cuadro');
  assert.ok(Math.max(...steps(frames)) <= MINUTE_MS);
});

test('informes en cada tick a 10000x: avanza 2 o 3 minutos por cuadro, casi sin atraso', () => {
  const reports = steadyReports({ speed: 10000, everyMs: 16, seconds: 4 });
  const { frames } = simulate(reports, { until: 4000 });
  const jumps = steps(frames.filter(frame => frame.now > 200));
  assert.ok(Math.max(...jumps) <= 6 * MINUTE_MS, `salto máximo ${Math.max(...jumps) / MINUTE_MS} min`);
  const lag = frames.filter(frame => frame.now > 200).map(frame => (frame.reported - frame.shown) / 10000);
  assert.ok(Math.max(...lag) <= 40, `atraso máximo ${Math.max(...lag).toFixed(0)} ms`);
});

test('informes espaciados (8 por segundo, +20 min): recorre el tramo en vez de saltar', () => {
  // Lo que llegaba antes a 10000x: la vela de 15m aparecía completa. Ahora se forma en varios cuadros
  const reports = steadyReports({ speed: 10000, everyMs: 120, seconds: 5 });
  const { frames } = simulate(reports, { until: 5000 });
  const settled = frames.filter(frame => frame.now > 500);
  const jumps = steps(settled);
  assert.ok(Math.max(...jumps) <= 8 * MINUTE_MS, `salto máximo ${Math.max(...jumps) / MINUTE_MS} min`);
  const moving = jumps.filter(jump => jump > 0).length / jumps.length;
  assert.ok(moving > 0.9, `se mueve en ${(moving * 100).toFixed(0)}% de los cuadros`);
  const lag = settled.map(frame => (frame.reported - frame.shown) / 10000);
  assert.ok(Math.max(...lag) <= 260, `atraso máximo ${Math.max(...lag).toFixed(0)} ms`);
});

test('informes irregulares (entre 90 y 150 ms): casi todos los cuadros avanzan y los saltos siguen chicos', () => {
  // La pantalla de la principal no publica a ritmo exacto: depende de cuándo cae su tick
  const random = seeded(7);
  const reports = [];
  for (let at = 0; at <= 6000; at += 90 + random() * 60) {
    reports.push({ at, time: START + Math.floor((at * 10000) / MINUTE_MS) * MINUTE_MS, playing: true, speed: 10000 });
  }
  const { frames } = simulate(reports, { until: 6000 });
  const settled = frames.filter(frame => frame.now > 800);
  const jumps = steps(settled);
  assert.ok(Math.max(...jumps) <= 12 * MINUTE_MS, `salto máximo ${Math.max(...jumps) / MINUTE_MS} min`);
  const moving = jumps.filter(jump => jump > 0).length / jumps.length;
  assert.ok(moving > 0.85, `se mueve en ${(moving * 100).toFixed(0)}% de los cuadros`);
  const lag = settled.map(frame => (frame.reported - frame.shown) / 10000);
  assert.ok(Math.max(...lag) <= 320, `atraso máximo ${Math.max(...lag).toFixed(0)} ms`);
});

test('principal frenada a un informe por segundo: sigue fluido, un segundo detrás', () => {
  const reports = steadyReports({ speed: 10000, everyMs: 1000, seconds: 8 });
  const { frames } = simulate(reports, { until: 8000 });
  const settled = frames.filter(frame => frame.now > 2500);
  const jumps = steps(settled);
  assert.ok(Math.max(...jumps) <= 12 * MINUTE_MS, `salto máximo ${Math.max(...jumps) / MINUTE_MS} min`);
  const moving = jumps.filter(jump => jump > 0).length / jumps.length;
  assert.ok(moving > 0.85, `se mueve en ${(moving * 100).toFixed(0)}% de los cuadros`);
  const lag = settled.map(frame => (frame.reported - frame.shown) / 10000);
  assert.ok(Math.max(...lag) <= 1700, `atraso máximo ${Math.max(...lag).toFixed(0)} ms`);
});

test('al pausar va de inmediato a la hora de la principal', () => {
  const reports = steadyReports({ speed: 10000, everyMs: 120, seconds: 2 });
  const last = reports[reports.length - 1];
  reports.push({ at: last.at + 30, time: last.time + 5 * MINUTE_MS, playing: false, speed: 10000 });
  const { frames, follower } = simulate(reports, { until: last.at + 60 });
  assert.equal(frames[frames.length - 1].shown, last.time + 5 * MINUTE_MS);
  assert.equal(follower.pending(), false);
});

test('al retroceder muestra la hora anterior en el mismo cuadro y no vuelve a mostrar lo de después', () => {
  const reports = steadyReports({ speed: 10000, everyMs: 16, seconds: 2 });
  const back = START + 30 * MINUTE_MS;
  reports.push({ at: 2050, time: back, playing: false, speed: 10000 });
  const { frames } = simulate(reports, { until: 2400 });
  const after = frames.filter(frame => frame.now >= 2050);
  assert.ok(after.length > 5);
  for (const frame of after) assert.equal(frame.shown, back);
});

test('retroceso mientras reproduce: también va directo', () => {
  const follower = createFollower();
  follower.report({ time: START + 600 * MINUTE_MS, playing: true, speed: 10000 }, 0);
  follower.frame(5);
  follower.report({ time: START + 100 * MINUTE_MS, playing: true, speed: 10000 }, 10);
  assert.equal(follower.frame(12), START + 100 * MINUTE_MS);
});

test('después de retroceder sigue recorriendo los tramos, no salta de informe en informe', () => {
  const before = steadyReports({ speed: 10000, everyMs: 16, seconds: 1 });
  const back = START + 10 * MINUTE_MS;
  const rewind = { at: 1100, time: back, playing: true, speed: 10000 }; // Retrocede sin pausar
  const again = steadyReports({ speed: 10000, everyMs: 120, seconds: 3, startAt: 1200, startTime: back });
  const { frames } = simulate([...before, rewind, ...again], { until: 4200 });
  const settled = frames.filter(frame => frame.now > 1700);
  assert.ok(Math.max(...steps(settled)) <= 8 * MINUTE_MS, `salto máximo ${Math.max(...steps(settled)) / MINUTE_MS} min`);
});

test('un salto grande hacia adelante no se recorre', () => {
  const follower = createFollower();
  follower.report({ time: START, playing: true, speed: 1000 }, 0);
  follower.frame(5);
  // 1000x: 3 s reales son 50 minutos. Un informe 10 horas después es un salto
  follower.report({ time: START + 600 * MINUTE_MS, playing: true, speed: 1000 }, 20);
  assert.equal(follower.frame(25), START + 600 * MINUTE_MS);
});

test('sin velocidad informada (principal de una versión anterior) muestra cada informe tal cual', () => {
  const follower = createFollower();
  follower.report({ time: START }, 0);
  follower.report({ time: START + 20 * MINUTE_MS }, 120);
  assert.equal(follower.frame(125), START + 20 * MINUTE_MS);
});

test('pestaña oculta: sin cuadros durante segundos, al volver alcanza a la principal sin pasarla', () => {
  const reports = steadyReports({ speed: 5000, everyMs: 16, seconds: 6 });
  // Cuadros normales 1 s, ninguno durante 4 s, y otra vez normales
  const gaps = (index) => (index === 60 ? 4000 : FRAME);
  const { frames } = simulate(reports, { until: 6000, frameGaps: gaps });
  const back = frames.filter(frame => frame.now > 5200);
  const lag = back.map(frame => (frame.reported - frame.shown) / 5000);
  assert.ok(Math.max(...lag) <= 60, `atraso al volver ${Math.max(...lag).toFixed(0)} ms`);
});

test('cambio de velocidad: sigue con la nueva sin adelantarse', () => {
  const slow = steadyReports({ speed: 1000, everyMs: 60, seconds: 2 });
  const from = slow[slow.length - 1];
  const fast = steadyReports({ speed: 20000, everyMs: 16, seconds: 2, startAt: from.at + 16, startTime: from.time });
  const { frames } = simulate([...slow, ...fast], { until: 4000 });
  const end = frames[frames.length - 1];
  assert.ok((end.reported - end.shown) / 20000 <= 40);
});

test('la hora mostrada cae en minutos enteros y nunca retrocede mientras la principal avanza', () => {
  const reports = steadyReports({ speed: 7500, everyMs: 90, seconds: 4 });
  const { frames } = simulate(reports, { until: 4000 });
  for (const frame of frames) assert.equal(frame.shown % MINUTE_MS, 0);
  assert.ok(Math.min(...steps(frames)) >= 0);
});

test('azar: con informes y cuadros irregulares nunca se adelanta ni retrocede sin que la principal lo haga', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const random = seeded(seed);
    const speed = [20, 500, 1000, 5000, 10000, 50000][Math.floor(random() * 6)];
    const reports = [];
    let at = 0;
    let time = START;
    let playing = true;
    while (at < 6000) {
      at += 4 + random() * (random() < 0.1 ? 1500 : 150);
      const roll = random();
      if (roll < 0.03) time -= Math.floor(random() * 500) * MINUTE_MS;         // retroceso
      else if (roll < 0.05) time += Math.floor(random() * 5000) * MINUTE_MS;   // salto adelante
      else if (playing) time += Math.floor((random() * 2 * speed * 100) / MINUTE_MS) * MINUTE_MS;
      if (random() < 0.05) playing = !playing;
      reports.push({ at, time, playing, speed });
    }
    const frameGaps = () => 8 + random() * (random() < 0.05 ? 600 : 30);
    const follower = createFollower();
    let next = 0;
    let reported = null;
    let previousShown = null;
    let rewound = false;
    for (let now = 0; now <= 6500; now += frameGaps()) {
      while (next < reports.length && reports[next].at <= now) {
        const { at: reportAt, ...clock } = reports[next++];
        if (reported !== null && clock.time < reported) rewound = true;
        follower.report(clock, reportAt);
        reported = clock.time;
      }
      const shown = follower.frame(now);
      if (shown === null) continue;
      assert.ok(shown <= reported, `semilla ${seed}: se adelanta ${shown - reported} ms`);
      if (previousShown !== null && !rewound) assert.ok(shown >= previousShown, `semilla ${seed}: retrocede sin motivo`);
      previousShown = shown;
      rewound = false;
    }
    // Al final, con la principal quieta, termina en su hora
    follower.report({ time: reported, playing: false, speed }, 7000);
    assert.equal(follower.frame(7001), reported, `semilla ${seed}: no termina en la hora de la principal`);
  }
});

test('reset: vuelve a esperar el primer informe', () => {
  const follower = createFollower();
  follower.report({ time: START, playing: true, speed: 1000 }, 0);
  follower.reset();
  assert.equal(follower.frame(10), null);
  follower.report({ time: START + MINUTE_MS, playing: false, speed: 1000 }, 20);
  assert.equal(follower.frame(21), START + MINUTE_MS);
});

test('principales: sigue a la primera que informa', () => {
  const picker = createSourcePicker();
  assert.deepEqual(picker.accept('a', START, 0), { follow: true, changed: true });
  assert.deepEqual(picker.accept('a', START + MINUTE_MS, 16), { follow: true, changed: false });
  assert.equal(picker.current(), 'a');
});

test('principales: otra pestaña quieta no interrumpe a la que reproduce', () => {
  const picker = createSourcePicker();
  picker.accept('a', START, 0);
  let now = 0;
  for (let i = 1; i <= 200; i++) {
    now = i * 16;
    assert.equal(picker.accept('a', START + i * MINUTE_MS, now).follow, true);
    // La otra repite su estado cada segundo, siempre con la misma hora
    if (i % 60 === 0) assert.equal(picker.accept('vieja', START - 86400000, now).follow, false);
  }
  assert.equal(picker.current(), 'a');
});

test('principales: dos reproduciendo a la vez no se alternan', () => {
  const picker = createSourcePicker();
  picker.accept('a', START, 0);
  picker.accept('b', START + 500 * MINUTE_MS, 1);
  for (let i = 1; i <= 100; i++) {
    assert.equal(picker.accept('a', START + i * MINUTE_MS, i * 16).follow, true);
    assert.equal(picker.accept('b', START + (500 + i) * MINUTE_MS, i * 16 + 1).follow, false);
  }
});

test('principales: si la que seguía se detiene y otra avanza, pasa a esa', () => {
  const picker = createSourcePicker();
  picker.accept('a', START, 0);
  picker.accept('a', START + MINUTE_MS, 100);
  picker.accept('b', START + 900 * MINUTE_MS, 200);              // primera vez: todavía no avanzó
  assert.equal(picker.accept('b', START + 901 * MINUTE_MS, 300).follow, false, 'la otra avanzó hace muy poco');
  picker.accept('a', START + MINUTE_MS, 1100);                    // repite su estado, quieta
  assert.deepEqual(picker.accept('b', START + 902 * MINUTE_MS, 1700), { follow: true, changed: true });
  assert.equal(picker.accept('a', START + MINUTE_MS, 2100).follow, false);
});

test('principales: si la que seguía se recargó, toma a la nueva aunque esté en pausa', () => {
  const picker = createSourcePicker();
  picker.accept('a', START, 0);
  picker.accept('a', START, 1000);
  // La pestaña se recargó: nace otra principal, quieta, y la anterior ya no informa
  assert.equal(picker.accept('nueva', START + 7 * 86400000, 6500).follow, false, 'todavía puede estar viva');
  assert.deepEqual(picker.accept('nueva', START + 7 * 86400000, 16500), { follow: true, changed: true });
});

test('principales: si la que seguía avisa que se cierra, la siguiente que informe toma su lugar', () => {
  const picker = createSourcePicker();
  picker.accept('a', START, 0);
  picker.accept('nueva', START + 86400000, 100);
  picker.release('otra');                                          // el aviso de otra pestaña no cambia nada
  assert.equal(picker.current(), 'a');
  picker.release('a');
  assert.deepEqual(picker.accept('nueva', START + 86400000, 200), { follow: true, changed: true });
});

test('principales: una principal de una versión anterior, sin identificador, también se sigue', () => {
  const picker = createSourcePicker();
  assert.equal(picker.accept(undefined, START, 0).follow, true);
  assert.equal(picker.accept(undefined, START + MINUTE_MS, 120).follow, true);
  assert.equal(picker.current(), 'sin-id');
});

test('mensajes: del estado sale la hora de la pantalla de la principal, con su velocidad', () => {
  const state = { type: 'state', currentTime: START + MINUTE_MS, playing: true, speed: 5000 };
  assert.deepEqual(reportOf(state), { time: START + MINUTE_MS, playing: true, speed: 5000, step: undefined });
  assert.equal(reportOf({ ...state, step: 300000 }).step, 300000);
  // Una principal de una versión anterior no dice si reproduce: se toma como quieta y se muestra tal cual
  assert.deepEqual(reportOf({ type: 'state', currentTime: START }), { time: START, playing: false, speed: undefined, step: undefined });
  assert.equal(reportOf({ type: 'state' }), null);
  assert.equal(reportOf({ type: 'hello', currentTime: START }), null);
  assert.equal(reportOf(null), null);
});

test('mensajes: lo básico del estado solo cambia con el símbolo, el inicio o la fecha oculta', () => {
  const state = { type: 'state', symbol: 'BTCUSDT', simulationStartTime: START, currentTime: START, trades: [], boxes: [] };
  const basics = replayBasics(state);
  assert.equal(sameBasics(basics, replayBasics({ ...state, currentTime: START + MINUTE_MS, trades: [{ id: 1 }] })), true);
  assert.equal(sameBasics(basics, replayBasics({ ...state, symbol: 'ETHUSDT' })), false);
  assert.equal(sameBasics(basics, replayBasics({ ...state, simulationStartTime: START + 1 })), false);
  const blind = replayBasics({ ...state, blindAnchor: START, blindScale: { base: 100, ref: 60000 } });
  assert.equal(sameBasics(basics, blind), false);
  assert.equal(sameBasics(blind, replayBasics({ ...state, blindAnchor: START, blindScale: { base: 100, ref: 60000 } })), true);
  assert.equal(sameBasics(null, basics), false);
});

test('mensajes: con un segundo gráfico conectado el reloj avanza de a 1 minuto', () => {
  assert.deepEqual(stepTimeframes('1h', null), ['1h']);
  assert.deepEqual(stepTimeframes('1h', '4h'), ['1h', 1]);
  assert.deepEqual(stepTimeframes('15m', '15m'), ['15m', 1]);
  assert.deepEqual(stepTimeframes('1h', '15m', '5m'), ['1h', 5], 'sin velas de 1 minuto en esa fecha, de a 5');
  assert.deepEqual(stepTimeframes('1h', null, '5m'), ['1h']);
});

test('como en la app (cuadros solo mientras queda tramo): a 10000x con informes cada 120 ms no salta', () => {
  const follower = createFollower();
  const shownAt = [];
  let nextReport = 0;
  let framing = false;
  for (let now = 0; now <= 5000; now += FRAME) {
    while (nextReport <= now) {
      follower.report({ time: START + Math.floor((nextReport * 10000) / MINUTE_MS) * MINUTE_MS, playing: true, speed: 10000 }, nextReport);
      nextReport += 120;
      framing = true; // La app pide un cuadro con cada informe
    }
    if (!framing) continue;
    shownAt.push(follower.frame(now));
    framing = follower.pending();
  }
  const settled = shownAt.slice(30);
  const jumps = settled.slice(1).map((time, i) => time - settled[i]);
  assert.ok(Math.max(...jumps) <= 8 * MINUTE_MS, `salto máximo ${Math.max(...jumps) / MINUTE_MS} min`);
  assert.ok(settled.length > 200, 'pide cuadros durante todo el tramo, no uno por informe');
});

test('tramo a medias: queda pendiente; al llegar a la hora informada, no', () => {
  const follower = createFollower();
  follower.report({ time: START, playing: true, speed: 10000 }, 0);
  follower.frame(1);
  follower.report({ time: START + 20 * MINUTE_MS, playing: true, speed: 10000 }, 10);
  follower.frame(40);
  assert.equal(follower.pending(), true);
  follower.frame(2000);
  assert.equal(follower.pending(), false);
});

test('paso de 5 minutos (fecha sin velas de 1 minuto): cada paso se muestra al llegar, sin recorrerlo', () => {
  // A 200x un paso de 5 minutos llega cada 1500 ms. Recorrerlo dejaría el gráfico un paso entero detrás
  const follower = createFollower();
  for (let k = 0; k < 6; k++) {
    const at = k * 1500;
    follower.report({ time: START + k * 5 * MINUTE_MS, playing: true, speed: 200, step: 5 * MINUTE_MS }, at);
    assert.equal(follower.frame(at + 16), START + k * 5 * MINUTE_MS);
  }
  // Con informes de varios pasos, lo recorrido cae en múltiplos de 5 minutos
  follower.report({ time: START + 60 * MINUTE_MS, playing: true, speed: 10000, step: 5 * MINUTE_MS }, 9000);
  const mid = follower.frame(9050);
  assert.equal((mid - START) % (5 * MINUTE_MS), 0);
  assert.ok(mid < START + 60 * MINUTE_MS);
});

test('después de una pausa larga, un informe atrasado se alcanza pronto', () => {
  const follower = createFollower();
  let at = 0;
  let time = START;
  for (; at < 1200; at += 120) { time += 20 * MINUTE_MS; follower.report({ time, playing: true, speed: 10000 }, at); follower.frame(at + 1); }
  follower.report({ time, playing: false, speed: 10000 }, at);       // pausa de 10 minutos
  at += 600000;
  for (let i = 0; i < 5; i++, at += 120) { time += 20 * MINUTE_MS; follower.report({ time, playing: true, speed: 10000 }, at); follower.frame(at + 60); }
  assert.ok(follower.state().interval < 1000, `el intervalo no hereda la pausa: ${follower.state().interval}`);
  time += 100 * MINUTE_MS;                                             // un informe atrasado 600 ms
  follower.report({ time, playing: true, speed: 10000 }, at + 480);
  let now = at + 480;
  while (follower.pending() && now < at + 5000) { now += FRAME; follower.frame(now); }
  assert.ok(now - (at + 480) < 450, `tarda ${Math.round(now - at - 480)} ms en alcanzar a la principal`);
});

test('una hora informada fuera de minuto entero no hace retroceder lo mostrado', () => {
  const follower = createFollower();
  follower.report({ time: START + 30000, playing: true, speed: 1000 }, 0);
  assert.equal(follower.frame(1), START + 30000);
  follower.report({ time: START + 30000 + 2 * MINUTE_MS, playing: true, speed: 1000 }, 100);
  let previous = START + 30000;
  for (let now = 116; now < 400; now += FRAME) {
    const shown = follower.frame(now);
    assert.ok(shown >= previous, 'no baja');
    previous = shown;
  }
});

test('principales: la que reproduce a 1x no cede ante otra que también avanza', () => {
  const picker = createSourcePicker();
  picker.accept('a', START, 0, true);
  picker.accept('b', START + 500 * MINUTE_MS, 10, true);
  for (let k = 1; k <= 5; k++) {
    assert.equal(picker.accept('a', START + k * MINUTE_MS, k * 60000, true).follow, true);
    // Entre dos avances la seguida sigue respondiendo al latido del 2.º gráfico, cada 5 s
    for (let beat = 1; beat <= 11; beat++) {
      picker.accept('a', START + k * MINUTE_MS, k * 60000 + beat * 5000, true);
      if (beat === 6) assert.equal(picker.accept('b', START + (500 + k) * MINUTE_MS, k * 60000 + 30001, true).follow, false);
    }
  }
});

test('principales: una vieja y quieta no toma el lugar aunque la seguida reproduzca mucho rato', () => {
  const picker = createSourcePicker();
  picker.accept('a', START, 0, true);
  for (let i = 1; i <= 2500; i++) {
    assert.equal(picker.accept('a', START + i * MINUTE_MS, i * 16, true).follow, true);
    if (i % 60 === 0) assert.equal(picker.accept('vieja', START - 86400000, i * 16, false).follow, false);
  }
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    await run();
    console.log(`ok    ${name}`);
  } catch (error) {
    failed++;
    console.log(`FALLA ${name}\n${error.message}`);
  }
}
console.log(`${tests.length - failed} de ${tests.length} correctas`);
process.exit(failed ? 1 : 0);
