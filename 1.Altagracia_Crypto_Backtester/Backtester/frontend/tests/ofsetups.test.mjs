// Pruebas de la biblioteca de setups: notación, recetas válidas y lo que el usuario cambia.
// Uso: node tests/ofsetups.test.mjs
import assert from 'node:assert/strict';
import { OF_ELEMENTS } from '../src/components/indicators/ofElements.js';
import {
  DEFAULT_RESERVE, SETUP_LIBRARY, activeRecipes, allRecipes, cleanRecipe, defaultSetupsConfig, parseSpec, recipeLabel, recipeText,
  recipeVersion, recipeVersions, reserveDate, reserveMs, withVersion
} from '../src/components/indicators/ofSetups.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);

test('la biblioteca tiene los 91 setups, numerados y con códigos conocidos', () => {
  assert.equal(SETUP_LIBRARY.length, 91);
  assert.deepEqual(SETUP_LIBRARY.map(r => r.num), Array.from({ length: 91 }, (_, k) => k + 1));
  for (const recipe of SETUP_LIBRARY) {
    for (const slot of recipe.slots) for (const code of slot.codes) assert.ok(OF_ELEMENTS[code], `${recipe.id}: ${code}`);
  }
});

test('los que dependen de Market Weakness quedan marcados', () => {
  assert.deepEqual(SETUP_LIBRARY.filter(r => r.missing.length).map(r => r.num), [15, 43, 53, 70]);
});

test('notación: misma vela, ventana, secuencia, alternativas y filtros', () => {
  assert.deepEqual(parseSpec('ST+ZP'), { mode: 'strict', window: 1, slots: [{ codes: ['ST'], group: 0 }, { codes: ['ZP'], group: 0 }], momentum: false, swing: { on: false, bars: 5, flex: 0, onSwing: false } });
  const seq = parseSpec('SW|BR>EX@2');
  assert.equal(seq.mode, 'sequence');
  assert.equal(seq.window, 2);
  assert.deepEqual(seq.slots, [{ codes: ['SW', 'BR'], group: 0 }, { codes: ['EX'], group: 1 }]);
  assert.equal(parseSpec('VA+VI@2 m').momentum, true);
  assert.equal(parseSpec('DD+EX@2 s').swing.on, true);
});

test('la receta propia descarta códigos desconocidos y acota la ventana', () => {
  const clean = cleanRecipe({ slots: [{ codes: ['ZZ'] }, { codes: ['EX', 'QQ'] }], window: 30, min: 9 });
  assert.deepEqual(clean.slots, [{ codes: ['EX'], group: 0 }]);
  assert.equal(clean.window, 5);
  assert.equal(clean.min, 1);
  assert.equal(cleanRecipe({ slots: [{ codes: ['ZZ'] }] }), null);
});

test('lo editado en un setup del libro se aplica y las propias se suman', () => {
  const config = { ...defaultSetupsConfig(), active: ['S2', 'R1'], overrides: { S2: { window: 3 } }, custom: [{ id: 'R1', name: 'Mi giro', slots: [{ codes: ['EX'] }] }] };
  const all = allRecipes(config);
  assert.equal(all.length, 92);
  assert.equal(all.find(r => r.id === 'S2').window, 3);
  assert.deepEqual(activeRecipes(config).map(r => r.id), ['S2', 'R1']);
  assert.equal(recipeLabel(all.find(r => r.id === 'R1')), 'MG');
  assert.equal(recipeLabel(all.find(r => r.id === 'S2')), 'S2');
});

test('el texto de la receta se lee como la notación', () => {
  assert.equal(recipeText(SETUP_LIBRARY[1]), 'AD>ST @2');
  assert.equal(recipeText(SETUP_LIBRARY[13]), 'ST m');
});

test('fecha de corte: la de fábrica salvo una fecha válida', () => {
  assert.equal(reserveDate({}), DEFAULT_RESERVE);
  assert.equal(reserveDate({ reserve: 'ayer' }), DEFAULT_RESERVE);
  assert.equal(reserveDate({ reserve: '2024-01-15' }), '2024-01-15');
  assert.equal(reserveMs({ reserve: '2025-07-01' }), Date.UTC(2025, 6, 1));
});

test('versiones: cada cambio guardado suma una, con fecha, y lo igual no se repite', () => {
  const recipe = cleanRecipe(SETUP_LIBRARY[1]);
  let config = defaultSetupsConfig();
  assert.equal(recipeVersion(config, recipe.id), 0);
  config = withVersion(config, { ...recipe, window: 2 });
  assert.equal(recipeVersion(config, recipe.id), 1);
  assert.ok(recipeVersions(config, recipe.id)[0].at > 0);
  assert.equal(withVersion(config, { ...recipe, window: 2 }), config, 'igual a la vigente: sin versión nueva');
  config = withVersion(config, { ...recipe, window: 3 }, 'del libro');
  const list = recipeVersions(config, recipe.id);
  assert.deepEqual(list.map(item => item.v), [1, 2]);
  assert.equal(list[1].recipe.window, 3);
  assert.equal(list[1].note, 'del libro');
  assert.equal(list[0].recipe.window, 2, 'la versión anterior no cambia');
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
