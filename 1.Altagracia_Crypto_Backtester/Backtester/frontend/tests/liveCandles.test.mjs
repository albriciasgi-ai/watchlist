// Velas del gráfico en vivo: la vela en curso nunca queda dos veces al final.
// Uso: node tests/liveCandles.test.mjs
import assert from 'node:assert/strict';

const { applyKline, mergeHistory, withForming } = await import('../src/components/liveCandles.js');

let count = 0;
const t = (name, fn) => { fn(); count++; console.log('ok', name); };

const M15 = 900000;
const T0 = Date.UTC(2026, 10, 12, 15, 0);
const bar = (i, extra = {}) => ({ timestamp: T0 + i * M15, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10, ...extra });
const times = (list) => list.map(c => c.timestamp);

t('el histórico quita su última vela si está en curso según el reloj', () => {
  const history = [bar(0), bar(1), bar(2)];
  const r = mergeHistory(history, [], null, M15, T0 + 2 * M15 + 60000);
  assert.deepEqual(times(r.closed), times([bar(0), bar(1)]));
  assert.equal(r.droppedLast, true);
});

t('caso de la suite: la recarga trae cerrada la vela que el WebSocket tenía en curso', () => {
  // El WebSocket mandó la vela 2 cerrada y todavía no la 3 (pocos trades). La recarga llega con la 2 cerrada y la 3 en curso
  const forming = bar(2, { close: 102.7 });
  const r = mergeHistory([bar(0), bar(1), bar(2), bar(3)], [bar(0), bar(1)], forming, M15, T0 + 3 * M15 + 5000);
  assert.deepEqual(times(r.closed), times([bar(0), bar(1), bar(2)]));
  assert.equal(r.forming, null);
  // Lo que se dibuja: una sola vela 2
  assert.deepEqual(times(withForming(r.closed, r.forming)), times([bar(0), bar(1), bar(2)]));
  // Llega la vela 3 por el WebSocket: la 2 no se agrega otra vez
  const step = applyKline(r.closed, r.forming, bar(3));
  assert.equal(step.forming.timestamp, bar(3).timestamp);
  assert.deepEqual(times(withForming(r.closed, step.forming)), times([bar(0), bar(1), bar(2), bar(3)]));
});

t('antes del arreglo: la misma secuencia dejaba la vela 2 dos veces', () => {
  // Reproduce el código anterior: histórico sin la vela en curso, vela en curso intacta y push al cambiar de hora
  const closed = [bar(0), bar(1), bar(2)];
  const forming = bar(2);
  const drawnBefore = [...closed, forming];
  assert.deepEqual(times(drawnBefore), times([bar(0), bar(1), bar(2), bar(2)]));
});

t('un mensaje de la vela cerrada la corrige y deja de ser vela en curso', () => {
  const closed = [bar(0), bar(1), bar(2)];
  const step = applyKline(closed, bar(2), bar(2, { close: 103.1, high: 104 }));
  assert.equal(step.forming, null);
  assert.equal(step.changed, true);
  assert.equal(closed[2].close, 103.1);
  assert.equal(closed[2].high, 104);
  assert.equal(closed.length, 3);
});

t('lo que el WebSocket cerró mientras se pedía el histórico se conserva', () => {
  // La recarga se pidió con la vela 2 en curso y llegó después del cierre: no trae la 2, el WebSocket ya la cerró
  const r = mergeHistory([bar(0), bar(1), bar(2)], [bar(0), bar(1), bar(2, { close: 102.9 })], bar(3), M15, T0 + 2 * M15 + 899000);
  // El reloj dice que la 2 está en curso (la petición salió antes del cierre): se quita del histórico
  assert.equal(r.droppedLast, true);
  // ...pero el WebSocket ya la había cerrado: se conserva su versión
  assert.deepEqual(times(r.closed), times([bar(0), bar(1), bar(2)]));
  assert.equal(r.closed[2].close, 102.9);
  assert.equal(r.forming.timestamp, bar(3).timestamp);
});

t('flujo normal: actualizar la vela en curso y pasarla a las cerradas al empezar la siguiente', () => {
  const closed = [bar(0), bar(1)];
  let forming = null;
  let s = applyKline(closed, forming, bar(2));
  forming = s.forming;
  assert.equal(s.rolled, false);
  s = applyKline(closed, forming, bar(2, { close: 102.2 }));
  forming = s.forming;
  assert.equal(forming.close, 102.2);
  s = applyKline(closed, forming, bar(3));
  forming = s.forming;
  assert.equal(s.rolled, true);
  assert.deepEqual(times(closed), times([bar(0), bar(1), bar(2)]));
  assert.equal(closed[2].close, 102.2);
  assert.equal(forming.timestamp, bar(3).timestamp);
});

t('mensajes viejos o fuera de orden no cambian nada', () => {
  const closed = [bar(0), bar(1), bar(2)];
  const forming = bar(4);
  assert.equal(applyKline(closed, forming, bar(1)).changed, false);
  assert.equal(applyKline(closed, forming, bar(3)).changed, false);
  assert.equal(closed.length, 3);
});

t('tope de velas cerradas', () => {
  const closed = [bar(0), bar(1), bar(2)];
  applyKline(closed, bar(3), bar(4), 3);
  assert.deepEqual(times(closed), times([bar(1), bar(2), bar(3)]));
});

t('withForming no repite una vela en curso que ya está entre las cerradas', () => {
  const closed = [bar(0), bar(1)];
  assert.equal(withForming(closed, bar(1)).length, 2);
  assert.equal(withForming(closed, bar(0)).length, 2);
  assert.equal(withForming(closed, bar(2)).length, 3);
  assert.equal(withForming([], bar(0)).length, 1);
  assert.equal(withForming(closed, null).length, 2);
});

console.log(`\n${count} pruebas de velas en vivo pasaron`);
