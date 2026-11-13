// Ritmo máximo de dibujo en vivo (la Watchlist de la suite): los precios que llegan se juntan en un dibujo cada
// tantos ms, y sin ritmo se dibuja en el cuadro siguiente como siempre.
// Uso: node tests/redrawPacer.test.mjs
import assert from 'node:assert/strict';

const { createRedrawPacer } = await import('../src/components/redrawPacer.js');

let count = 0;
const t = (name, fn) => { fn(); count++; console.log('ok', name); };

// Reloj y temporizadores falsos
function fakeClock() {
  const state = { now: 0, timers: [], frames: [], nextId: 1 };
  return {
    state,
    deps: {
      now: () => state.now,
      setTimer: (fn, ms) => { const id = state.nextId++; state.timers.push({ id, at: state.now + ms, fn }); return id; },
      clearTimer: (id) => { state.timers = state.timers.filter(x => x.id !== id); },
      frame: (fn) => { state.frames.push(fn); },
    },
    advance(ms) {
      const end = state.now + ms;
      for (;;) {
        const next = state.timers.filter(x => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        state.now = next.at;
        state.timers = state.timers.filter(x => x !== next);
        next.fn();
      }
      state.now = end;
    },
    runFrames() { const list = state.frames; state.frames = []; list.forEach(fn => fn()); },
  };
}

t('sin ritmo dibuja en el cuadro siguiente, una vez por cuadro', () => {
  const clock = fakeClock();
  let draws = 0;
  const pacer = createRedrawPacer(() => draws++, clock.deps);
  for (let i = 0; i < 5; i++) pacer.request(0);
  assert.equal(draws, 0);
  clock.runFrames();
  assert.equal(draws, 1);
  pacer.request(null);
  clock.runFrames();
  assert.equal(draws, 2);
});

t('con 500 ms: diez precios por segundo dan dos dibujos por segundo', () => {
  const clock = fakeClock();
  let draws = 0;
  const pacer = createRedrawPacer(() => draws++, clock.deps);
  for (let ms = 0; ms < 3000; ms += 100) {
    pacer.request(500);
    clock.advance(100);
  }
  // El primero sale al momento y luego uno cada 500 ms: a los 0, 0.5, 1, 1.5, 2, 2.5 y 3 s
  assert.equal(draws, 7);
});

t('con 30 s: un gráfico oculto se dibuja una vez cada 30 s aunque lleguen precios', () => {
  const clock = fakeClock();
  let draws = 0;
  const pacer = createRedrawPacer(() => draws++, clock.deps);
  for (let s = 0; s < 90; s++) {
    for (let k = 0; k < 10; k++) pacer.request(30000);
    clock.advance(1000);
  }
  // A los 0, 30, 60 y 90 s
  assert.equal(draws, 4);
});

t('al volverse visible, lo pendiente se dibuja ya y sigue el ritmo nuevo', () => {
  const clock = fakeClock();
  let draws = 0;
  const pacer = createRedrawPacer(() => draws++, clock.deps);
  pacer.request(30000);       // primer dibujo
  clock.advance(1000);
  pacer.request(30000);       // pendiente para dentro de 29 s
  assert.equal(draws, 1);
  pacer.flush();              // se ve: dibuja ya
  assert.equal(draws, 2);
  pacer.request(500);
  clock.advance(600);
  assert.equal(draws, 3);
});

t('cancelar deja de dibujar lo pendiente', () => {
  const clock = fakeClock();
  let draws = 0;
  const pacer = createRedrawPacer(() => draws++, clock.deps);
  pacer.request(500);
  clock.advance(10);
  pacer.request(500);
  pacer.cancel();
  clock.advance(5000);
  assert.equal(draws, 1);
  assert.equal(pacer.pending(), false);
});

console.log(`${count} pruebas pasan`);
