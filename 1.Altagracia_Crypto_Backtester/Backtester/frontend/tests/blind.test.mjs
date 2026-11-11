// Precio como índice y volumen relativo del modo "Fecha al azar y oculta".
// Uso: node tests/blind.test.mjs
import assert from 'node:assert/strict';
import {
  makeBlindScale, maskPrice, maskVolume, priceLabel, priceText, pricesHidden, quantityText, scaleFromCandles,
  setBlindAnchor, setBlindScale, unmaskPrice
} from '../src/components/backtesting/blindClock.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);
const reset = () => { setBlindAnchor(null); setBlindScale(null); };

test('sin modo oculto todo queda como siempre', () => {
  reset();
  assert.equal(pricesHidden(), false);
  assert.equal(maskPrice(81234.5), 81234.5);
  assert.equal(priceText(81234.5, 1), '81234.5');
  assert.equal(priceLabel(81234.5), '$81234.50');
  assert.equal(maskVolume(12.5), 12.5);
  assert.equal(quantityText(0.123), 0.123);
});

test('la base sale al azar entre 80 y 120, con 3 decimales', () => {
  assert.equal(makeBlindScale(80000, 100, () => 0).base, 80);
  assert.equal(makeBlindScale(80000, 100, () => 0.999999).base, 120);
  assert.equal(makeBlindScale(80000, 100, () => 0.5).base, 100);
  assert.equal(makeBlindScale(0, 100), null, 'sin precio no hay escala');
});

test('el índice conserva los porcentajes y se puede volver al precio real', () => {
  reset();
  setBlindAnchor(Date.UTC(2024, 0, 1));
  setBlindScale({ ref: 40000, base: 100, volRef: 50 });
  assert.equal(pricesHidden(), true);
  assert.equal(maskPrice(40000), 100);
  assert.equal(maskPrice(41000), 102.5, '+2.5% sigue siendo +2.5%');
  assert.equal(priceText(39000), '97.500');
  assert.equal(priceLabel(39000), '97.500', 'sin signo de dólar');
  assert.ok(Math.abs(unmaskPrice(maskPrice(43210.7)) - 43210.7) < 1e-9);
  assert.equal(maskVolume(50), 1000, 'la vela mediana del inicio vale 1,000');
  assert.equal(quantityText(0.1), '2.000');
});

test('sin fecha oculta la escala no actúa aunque quede guardada', () => {
  setBlindScale({ ref: 40000, base: 100, volRef: 50 });
  setBlindAnchor(null);
  assert.equal(maskPrice(41000), 41000);
});

test('la escala de un inicio usa la última vela antes de esa hora', () => {
  const candles = Array.from({ length: 200 }, (_, k) => ({ timestamp: k * 60000, close: 100 + k, volume: k + 1 }));
  const scale = scaleFromCandles(candles, 150 * 60000, () => 0.5);
  assert.equal(scale.ref, 249, 'cierre de la vela 149');
  assert.equal(scale.volRef, 103, 'mediana de las 96 velas hasta la 149');
  assert.equal(scaleFromCandles([], 0), null);
  reset();
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
