// Ajustes propios del 2.º gráfico: las claves de los indicadores se guardan aparte en su pestaña.
// Uso: node tests/secondarystorage.test.mjs
import assert from 'node:assert/strict';
import { OWN_PREFIX, installOwnSettings, isOwnKey } from '../src/components/backtesting/secondaryStorage.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);

/** Un localStorage de juguete: los métodos en su prototipo, como en el navegador */
function fakeStorage() {
  class FakeStorage {
    constructor() { this.data = new Map(); }
    getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
    setItem(key, value) { this.data.set(key, String(value)); }
    removeItem(key) { this.data.delete(key); }
  }
  const storage = new FakeStorage();
  return { storage, proto: FakeStorage.prototype };
}

test('las claves de ajustes son propias; lo que viaja entre pestañas no', () => {
  assert.equal(isOwnKey('orderflow_settings_BTCUSDT'), true);
  assert.equal(isOwnKey('support_resistance_2_config_ETHUSDT'), true);
  assert.equal(isOwnKey('indicator_panels_BTCUSDT'), true);
  assert.equal(isOwnKey('analysis_levels_v2_BTCUSDT'), false, 'lo elegido para el análisis llega a la orden de la principal');
  assert.equal(isOwnKey('liquidation_pins_BTCUSDT'), false);
  assert.equal(isOwnKey('of_setups_BTCUSDT'), false, 'las recetas son una sola biblioteca');
  assert.equal(isOwnKey('ui_theme'), false);
  assert.equal(isOwnKey('app1_grafico2'), false);
  assert.equal(isOwnKey(null), false);
});

test('mientras no se cambie nada aquí, lee lo de la principal', () => {
  const { storage, proto } = fakeStorage();
  storage.setItem('fvg_settings_BTCUSDT', '{"minSize":1}');
  const undo = installOwnSettings(storage, proto);
  assert.equal(storage.getItem('fvg_settings_BTCUSDT'), '{"minSize":1}');
  undo();
});

test('lo que se cambia aquí no toca la principal', () => {
  const { storage, proto } = fakeStorage();
  storage.setItem('orderflow_settings_BTCUSDT', 'principal');
  const undo = installOwnSettings(storage, proto);
  storage.setItem('orderflow_settings_BTCUSDT', 'segundo');
  assert.equal(storage.getItem('orderflow_settings_BTCUSDT'), 'segundo');
  assert.equal(storage.data.get('orderflow_settings_BTCUSDT'), 'principal', 'la clave de la principal sigue igual');
  assert.equal(storage.data.get(OWN_PREFIX + 'orderflow_settings_BTCUSDT'), 'segundo');
  undo();
  assert.equal(storage.getItem('orderflow_settings_BTCUSDT'), 'principal', 'en la principal se lee lo suyo');
});

test('restablecer aquí vuelve a fábrica, no a lo de la principal', () => {
  const { storage, proto } = fakeStorage();
  storage.setItem('vp_periodic_settings_BTCUSDT', 'principal');
  const undo = installOwnSettings(storage, proto);
  storage.removeItem('vp_periodic_settings_BTCUSDT');
  assert.equal(storage.getItem('vp_periodic_settings_BTCUSDT'), null);
  assert.equal(storage.data.get('vp_periodic_settings_BTCUSDT'), 'principal');
  storage.setItem('vp_periodic_settings_BTCUSDT', 'otra vez');
  assert.equal(storage.getItem('vp_periodic_settings_BTCUSDT'), 'otra vez');
  undo();
});

test('las demás claves se leen y escriben como siempre', () => {
  const { storage, proto } = fakeStorage();
  const undo = installOwnSettings(storage, proto);
  storage.setItem('analysis_levels_v2_BTCUSDT', '[1]');
  assert.equal(storage.data.get('analysis_levels_v2_BTCUSDT'), '[1]');
  storage.removeItem('analysis_levels_v2_BTCUSDT');
  assert.equal(storage.data.has('analysis_levels_v2_BTCUSDT'), false);
  undo();
});

test('otro almacén del mismo tipo (sessionStorage) no se desvía', () => {
  const { storage, proto } = fakeStorage();
  const other = new storage.constructor();
  const undo = installOwnSettings(storage, proto);
  other.setItem('orderflow_settings_BTCUSDT', 'x');
  assert.equal(other.data.get('orderflow_settings_BTCUSDT'), 'x');
  undo();
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
