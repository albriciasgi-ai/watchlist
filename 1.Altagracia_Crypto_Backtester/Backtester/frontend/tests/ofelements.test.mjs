// Pruebas de los Elementos OF: franjas cortadas solo con lo conocido, parámetros y EMA.
// Uso: node tests/ofelements.test.mjs
import assert from 'node:assert/strict';
import {
  OF_ELEMENTS, bandEnd, cleanOFElementsConfig, defaultOFElementsConfig, emaSeries, eventKey, knownEvents
} from '../src/components/indicators/ofElements.js';

const bar = (timestamp, low, high, close = high) => ({ timestamp, low, high, open: low, close });
const tests = [];
const test = (name, run) => tests.push([name, run]);
const band = (extra = {}) => ({ code: 'VA', dir: 1, t: 0, t0: 0, known: 2, lo: 100, hi: 110, ...extra });

test('la franja termina en la primera vela posterior que entra en ella', () => {
  const candles = [bar(0, 100, 115), bar(1, 112, 120), bar(2, 112, 125), bar(3, 111, 130), bar(4, 108, 120)];
  assert.equal(bandEnd(band(), candles, {}), 4);
});

test('las velas anteriores a que se conozca no la cortan', () => {
  // La vela 1 toca el precio, pero la franja recién se conoce al cerrar esa vela (known = 2)
  const candles = [bar(0, 100, 115), bar(1, 105, 120), bar(2, 115, 125)];
  assert.equal(bandEnd(band(), candles, {}), null);
});

test('sigue viva y se revisa de nuevo cuando llega otra vela', () => {
  const memo = {};
  const candles = [bar(0, 100, 115), bar(1, 112, 120), bar(2, 112, 125)];
  assert.equal(bandEnd(band(), candles, memo), null);
  candles.push(bar(3, 109, 118));
  assert.equal(bandEnd(band(), candles, memo), 3);
});

test('la vela en formación que cambia se vuelve a mirar', () => {
  const memo = {};
  const candles = [bar(0, 100, 115), bar(1, 112, 120), bar(2, 113, 125)];
  assert.equal(bandEnd(band(), candles, memo), null);
  candles[2] = bar(2, 109, 125); // La misma vela, ahora más abajo
  assert.equal(bandEnd(band(), candles, memo), 2);
});

test('al retroceder el reloj la vela que la cortó todavía no existe', () => {
  const memo = {};
  const candles = [bar(0, 100, 115), bar(1, 112, 120), bar(2, 112, 125), bar(3, 105, 120)];
  assert.equal(bandEnd(band(), candles, memo), 3);
  assert.equal(bandEnd(band(), candles.slice(0, 3), memo), null);
});

test('solo se ven los eventos conocidos y activos', () => {
  const codes = { VA: true, EX: false };
  const events = [band({ known: 5 }), band({ known: 9 }), band({ code: 'EX', known: 1 })];
  assert.deepEqual(knownEvents(events, 6, codes).map(e => e.known), [5]);
});

test('la clave distingue elemento, lado, vela y precio', () => {
  assert.notEqual(eventKey(band()), eventKey(band({ dir: -1 })));
  assert.notEqual(eventKey(band()), eventKey(band({ lo: 101 })));
});

test('parámetros fuera de rango quedan en el límite y los códigos desconocidos se descartan', () => {
  const clean = cleanOFElementsConfig({ target: 80, volFilter: 30, maxBands: -3, bandOpacity: 'x', codes: { ZZ: true, ZP: true } });
  assert.equal(clean.target, 20);
  assert.equal(clean.volFilter, 10);
  assert.equal(cleanOFElementsConfig({}).volFilter, 2);
  assert.equal(cleanOFElementsConfig({}).codes.ST, false, 'los de filtro de volumen vienen apagados');
  assert.equal(clean.maxBands, 0);
  assert.equal(clean.bandOpacity, defaultOFElementsConfig().bandOpacity);
  assert.equal(clean.codes.ZP, true);
  assert.equal('ZZ' in clean.codes, false);
  assert.deepEqual(Object.keys(clean.codes).sort(), Object.keys(OF_ELEMENTS).sort());
});

test('la EMA 14 con pendiente positiva en una subida pareja', () => {
  const candles = Array.from({ length: 40 }, (_, i) => bar(i, 100 + i, 102 + i, 101 + i));
  const { ema, slope } = emaSeries(candles);
  assert.ok(ema[39] < candles[39].close && ema[39] > candles[20].close);
  assert.ok(slope[39] > 0.25);
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`ok ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FALLA ${name}: ${error.message}`);
  }
}
console.log(`${tests.length - failed} de ${tests.length} pruebas correctas`);
process.exit(failed ? 1 : 0);
