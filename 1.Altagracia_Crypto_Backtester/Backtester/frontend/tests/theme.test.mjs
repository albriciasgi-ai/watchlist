// Estilo Nítido: colores configurables, contraste del texto, ejes redondos y horas de Colombia.
// Uso: node tests/theme.test.mjs
import assert from 'node:assert/strict';
import {
  COLOR_GROUPS, DEFAULT_COLORS, THEME, contrast, crossTime, isNewTheme, isTimeTick, niceStep, niceTimeStep,
  priceDecimals, resetThemeColors, setThemeColors, themeColors, themeRevision, timeTick
} from '../src/components/uiTheme.js';

let count = 0;
const t = (name, fn) => { fn(); count++; console.log('ok', name); };
const MINUTE = 60000;
const HOUR = 60 * MINUTE;

t('sin navegador (pruebas) se dibuja con el aspecto clásico', () => {
  assert.equal(isNewTheme(), false);
});

t('el modal ofrece cada color de Nítido una sola vez', () => {
  const keys = COLOR_GROUPS.flatMap(group => group.fields.map(([key]) => key));
  assert.deepEqual([...keys].sort(), Object.keys(DEFAULT_COLORS).sort());
});

t('el texto de compra, venta y desequilibrios se lee sobre el fondo', () => {
  for (const key of ['upText', 'downText']) assert.ok(contrast(THEME[key], THEME.chartBg) >= 4.5, key);
  for (const key of ['fpImbUpText', 'fpImbDownText']) assert.ok(contrast(THEME[key], THEME.chartBg) >= 7, key);
});

t('un color cambiado se aplica, se guarda y vuelve al de Nítido', () => {
  const before = themeRevision();
  setThemeColors({ up: '#2563eb' });
  assert.equal(themeColors().up, '#2563EB');
  assert.equal(THEME.up, '#2563EB');
  assert.equal(THEME.upRgb, '37, 99, 235');
  assert.ok(themeRevision() > before);
  setThemeColors({ up: DEFAULT_COLORS.up });
  assert.equal(themeColors().up, DEFAULT_COLORS.up);
  setThemeColors({ down: '#000000', grid: '#FFFFFF' });
  resetThemeColors();
  assert.deepEqual(themeColors(), DEFAULT_COLORS);
});

t('colores inválidos o campos desconocidos no cambian nada', () => {
  setThemeColors({ up: 'rojo', nope: '#000000', down: '#12345' });
  assert.deepEqual(themeColors(), DEFAULT_COLORS);
  assert.equal(THEME.nope, undefined);
});

t('un verde muy claro se oscurece lo justo para leerse como texto', () => {
  setThemeColors({ up: '#A7F3D0' });
  assert.ok(contrast(THEME.upText, THEME.chartBg) >= 4.5);
  assert.equal(THEME.up, '#A7F3D0'); // La vela conserva el color elegido
  resetThemeColors();
});

t('precios redondos: pasos de 1, 2, 2.5 o 5 por potencia de 10', () => {
  assert.equal(niceStep(1000, 560, 56, 0.1), 100);
  assert.equal(niceStep(2309, 355, 56, 0.1), 500);
  assert.equal(niceStep(0.5, 400, 56, 0.0001), 0.1);
  assert.equal(niceStep(0.0001, 400, 56, 0.1), 0.1); // Nunca menos que el tick
});

t('horas redondas en hora de Colombia', () => {
  const midnight = Date.UTC(2026, 9, 24, 5, 0); // 24 oct 00:00 en Colombia
  assert.equal(isTimeTick(midnight, 3 * HOUR), true);
  assert.equal(isTimeTick(midnight + HOUR, 3 * HOUR), false);
  assert.deepEqual(timeTick(midnight, 3 * HOUR), { text: '24 oct', strong: true });
  assert.deepEqual(timeTick(midnight + 15 * HOUR, 3 * HOUR), { text: '15:00', strong: false });
  assert.equal(crossTime(Date.UTC(2026, 9, 24, 15, 30)), '24 oct 10:30');
});

t('el paso de tiempo deja las marcas separadas y nunca es menor que la vela', () => {
  assert.equal(niceTimeStep(4, 15 * MINUTE, 90), 6 * HOUR);
  assert.equal(niceTimeStep(200, 15 * MINUTE, 90), 15 * MINUTE);
  assert.equal(niceTimeStep(40, 4 * HOUR, 90), 12 * HOUR);
});

t('los decimales del precio salen de las velas de la moneda', () => {
  assert.equal(priceDecimals([{ open: 80907.2, close: 80910 }, { open: 1, close: 2.5 }]), 1);
  assert.equal(priceDecimals([{ open: 0.5123, close: 0.51 }]), 4);
  assert.equal(priceDecimals([{ open: 100, close: 101 }]), 0);
});

console.log(`${count} de ${count} pruebas correctas`);
