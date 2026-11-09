// Estilos Nítido, Oscuro, Personalizado y Muhammad: colores, contraste del texto, ejes redondos y horas de Colombia.
// Uso: node tests/theme.test.mjs
import assert from 'node:assert/strict';
import {
  COLOR_GROUPS, DARK_COLORS, DEFAULT_COLORS, MUHAMMAD_COLORS, STYLES, THEME, contrast, crossTime, customList, hexOfRgb,
  isCustom, isNewTheme, isTimeTick, markCustom, niceStep, niceTimeStep, priceDecimals, resetThemeColors, rgbOf,
  setTheme, setThemeColors, themeBaseColors, themeColors, themeEditable, themeName, themeRevision, timeTick
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

t('Personalizado: un color cambiado se aplica, se guarda y vuelve al de Nítido', () => {
  setTheme('personalizado');
  assert.equal(themeEditable(), true);
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
  setTheme('clasico');
});

t('Nítido queda como es: los colores de Personalizado no lo tocan', () => {
  setTheme('personalizado');
  setThemeColors({ up: '#2563eb', chartBg: '#FAFAF0' });
  setTheme('nitido');
  assert.equal(themeEditable(), false);
  assert.deepEqual(themeColors(), DEFAULT_COLORS);
  assert.equal(THEME.up, DEFAULT_COLORS.up);
  setTheme('personalizado');
  assert.equal(THEME.up, '#2563EB', 'Personalizado conserva lo suyo');
  assert.equal(THEME.chartBg, '#FAFAF0');
  resetThemeColors();
  setTheme('clasico');
});

t('Oscuro y Muhammad se cambian: cada uno guarda lo suyo y vuelve a su paleta; Nítido no cambia', () => {
  setTheme('nitido');
  setThemeColors({ up: '#00FF00' });
  assert.deepEqual(themeColors(), DEFAULT_COLORS, 'Nítido no acepta cambios');

  setTheme('oscuro');
  assert.equal(themeEditable(), true);
  setThemeColors({ up: '#00ff00', chartBg: '#000000' });
  assert.equal(THEME.up, '#00FF00');
  assert.equal(THEME.chartBg, '#000000');
  assert.deepEqual(themeBaseColors(), DARK_COLORS);

  setTheme('muhammad');
  assert.equal(themeEditable(), true);
  assert.equal(THEME.up, MUHAMMAD_COLORS.up, 'lo de Oscuro no llega a Muhammad');
  setThemeColors({ down: '#aa0000' });
  assert.equal(THEME.down, '#AA0000');
  setThemeColors({ down: MUHAMMAD_COLORS.down }); // Volver a su color lo quita de lo guardado
  assert.deepEqual(themeColors(), MUHAMMAD_COLORS);
  setThemeColors({ text: '#000000' });

  setTheme('personalizado');
  assert.deepEqual(themeColors(), DEFAULT_COLORS, 'Personalizado no recibe lo de los otros');

  setTheme('oscuro');
  assert.equal(THEME.up, '#00FF00', 'Oscuro conserva lo suyo');
  resetThemeColors();
  assert.deepEqual(themeColors(), DARK_COLORS);
  setTheme('muhammad');
  assert.equal(THEME.text, '#000000');
  resetThemeColors();
  assert.deepEqual(themeColors(), MUHAMMAD_COLORS);
  setTheme('clasico');
});

t('un estilo oscuro que el usuario aclara deja de ser oscuro, y uno claro que oscurece pasa a serlo', () => {
  setTheme('oscuro');
  setThemeColors({ chartBg: '#FFFFFF' });
  assert.equal(THEME.dark, false);
  resetThemeColors();
  assert.equal(THEME.dark, true);
  setTheme('personalizado');
  setThemeColors({ chartBg: '#101010' });
  assert.equal(THEME.dark, true);
  resetThemeColors();
  setTheme('clasico');
});

t('colores inválidos o campos desconocidos no cambian nada', () => {
  setTheme('personalizado');
  setThemeColors({ up: 'rojo', nope: '#000000', down: '#12345' });
  assert.deepEqual(themeColors(), DEFAULT_COLORS);
  assert.equal(THEME.nope, undefined);
  setTheme('clasico');
});

t('un verde muy claro se oscurece lo justo para leerse como texto', () => {
  setTheme('personalizado');
  setThemeColors({ up: '#A7F3D0' });
  assert.ok(contrast(THEME.upText, THEME.chartBg) >= 4.5);
  assert.equal(THEME.up, '#A7F3D0'); // La vela conserva el color elegido
  resetThemeColors();
  setTheme('clasico');
});

t('cada estilo trae los 21 colores, todos válidos, y uno desconocido vuelve a Nítido', () => {
  assert.deepEqual(STYLES.map(style => style.id), ['nitido', 'oscuro', 'personalizado', 'muhammad', 'clasico']);
  for (const palette of [DEFAULT_COLORS, DARK_COLORS, MUHAMMAD_COLORS]) {
    assert.deepEqual(Object.keys(palette).sort(), Object.keys(DEFAULT_COLORS).sort());
    for (const value of Object.values(palette)) assert.match(value, /^#[0-9A-F]{6}$/);
  }
  setTheme('no-existe');
  assert.equal(themeName(), 'nitido');
  setTheme('clasico');
});

t('Oscuro: texto y datos se leen sobre el fondo oscuro y lo que se deriva se aclara', () => {
  setTheme('oscuro');
  assert.equal(THEME.dark, true);
  assert.ok(contrast(THEME.text, THEME.chartBg) >= 7);
  assert.ok(contrast(THEME.textMuted, THEME.chartBg) >= 4.5);
  for (const key of ['up', 'down', 'fpBuy', 'fpSell', 'fpPoc', 'oiUp', 'oiDown', 'divergence', 'crosshair']) {
    assert.ok(contrast(THEME[key], THEME.chartBg) >= 3, key);
  }
  for (const key of ['upText', 'downText']) assert.ok(contrast(THEME[key], THEME.chartBg) >= 4.5, key);
  for (const key of ['fpImbUpText', 'fpImbDownText']) assert.ok(contrast(THEME[key], THEME.chartBg) >= 7, key);
  assert.ok(contrast('#FFFFFF', THEME.tagBg) >= 7, 'texto blanco en las etiquetas de la cruz');
  assert.match(THEME.fpEmpty, /^rgba\(255, 255, 255/);
  assert.equal(THEME.labelBg, 'rgba(19, 23, 34, 0.85)');
  setTheme('clasico');
  assert.equal(THEME.dark, false);
});

t('Muhammad: fondo claro, texto y datos que se leen sobre él', () => {
  setTheme('muhammad');
  assert.equal(THEME.dark, false);
  assert.ok(contrast(THEME.text, THEME.chartBg) >= 7);
  assert.ok(contrast(THEME.textMuted, THEME.chartBg) >= 4.5);
  for (const key of ['up', 'down', 'fpBuy', 'fpSell', 'fpPoc', 'oiUp', 'oiDown', 'divergence']) {
    assert.ok(contrast(THEME[key], THEME.chartBg) >= 3, key);
  }
  assert.ok(contrast('#FFFFFF', THEME.tagBg) >= 4.5, 'texto blanco en las etiquetas de la cruz');
  setTheme('clasico');
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

// Lo que el usuario elige en el modal de un indicador gana sobre el estilo
const VP = { baseColor: '#2196F3', valueAreaColor: '#FF9800', vahValColor: ['#9C27B0', '#2196F3'], useGradient: true };

t('lo elegido en el modal del indicador gana: manda la lista customVisual', () => {
  const config = { valueAreaColor: '#FF9800', baseColor: '#123456', customVisual: ['valueAreaColor'] };
  assert.equal(isCustom(config, 'valueAreaColor', VP.valueAreaColor), true); // Aunque sea el color de fábrica
  assert.equal(isCustom(config, 'baseColor', VP.baseColor), false); // No está en la lista
});

t('ajustes de antes de la lista: cuenta lo que difiere de fábrica', () => {
  const config = { valueAreaColor: '#ff9800', baseColor: '#9C27B0', vahValColor: '#2196f3', useGradient: false };
  assert.equal(isCustom(config, 'valueAreaColor', VP.valueAreaColor), false); // Igual, sin importar mayúsculas
  assert.equal(isCustom(config, 'baseColor', VP.baseColor), true);
  assert.equal(isCustom(config, 'vahValColor', VP.vahValColor), false); // Cualquiera de los de fábrica
  assert.equal(isCustom(config, 'useGradient', VP.useGradient), true);
  assert.equal(isCustom({}, 'baseColor', VP.baseColor), false); // Sin valor no hay elección
  assert.equal(isCustom({ colors: { bullish: '#00FF00' } }, 'colors.bullish', '#34C759'), true); // Clave anidada
  assert.equal(isCustom({ stackedBuyColor: '38, 166, 154' }, 'stackedBuyColor', '38,166,154'), false); // Espacios no cuentan
});

t('al cambiar un ajuste se agrega a la lista sin perder lo elegido antes', () => {
  const legacy = { baseColor: '#9C27B0', valueAreaColor: '#FF9800' };
  assert.deepEqual(customList(legacy, VP), ['baseColor']);
  assert.deepEqual(markCustom(legacy, 'valueAreaColor', VP), ['baseColor', 'valueAreaColor']);
  const listed = { customVisual: ['useGradient'] };
  assert.deepEqual(markCustom(listed, 'useGradient', VP), ['useGradient']);
  assert.deepEqual(markCustom({ customVisual: [] }, 'baseColor', VP), ['baseColor']);
});

t('conversión de colores para transparencias', () => {
  assert.equal(rgbOf('#2563EB'), '37, 99, 235');
  assert.equal(rgbOf('azul'), null);
  assert.equal(hexOfRgb('38,166,154'), '#26A69A');
});

console.log(`${count} de ${count} pruebas correctas`);
