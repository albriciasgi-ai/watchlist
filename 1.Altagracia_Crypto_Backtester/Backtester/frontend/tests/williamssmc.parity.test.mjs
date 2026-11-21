// Paridad: williams.js y smcStructure.js (navegador) contra backend/williams.py y backend/smc.py (probador de reglas).
// Mismas velas, mismos números al bit. Python: BACKEND_PYTHON, el .venv de esta copia o el de la copia principal.
// Uso: node tests/williamssmc.parity.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { barsOf, computeWilliams } from '../src/components/indicators/williams.js';
import { computeSmc } from '../src/components/indicators/smcStructure.js';

const MAIN_PYTHON = 'C:\\Users\\inven\\OneDrive\\Documentos\\GitHub\\watchlist\\1.Altagracia_Crypto_Backtester\\Backtester\\backend\\.venv\\Scripts\\python.exe';
const LOCAL_PYTHON = fileURLToPath(new URL(process.platform === 'win32' ? '../../backend/.venv/Scripts/python.exe' : '../../backend/.venv/bin/python', import.meta.url));
const BACKEND = fileURLToPath(new URL('../../backend', import.meta.url));

function backendPython() {
  if (process.env.BACKEND_PYTHON) return process.env.BACKEND_PYTHON;
  // El .venv de esta copia sirve solo si está completo (un worktree puede traer uno sin pyvenv.cfg)
  if (existsSync(LOCAL_PYTHON) && existsSync(join(LOCAL_PYTHON, '..', '..', 'pyvenv.cfg'))) return LOCAL_PYTHON;
  if (existsSync(MAIN_PYTHON)) return MAIN_PYTHON;
  throw new Error('No encuentro el Python del backend: indícalo en BACKEND_PYTHON');
}

function randomCandles(n, seed, start = 100, step = 14400000) {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out = [];
  let price = start;
  for (let i = 0; i < n; i += 1) {
    const open = price;
    const close = open * (1 + (rand() - 0.5) * 0.04);
    out.push({ timestamp: 1600000000000 + i * step, open, high: Math.max(open, close) * (1 + rand() * 0.015), low: Math.min(open, close) * (1 - rand() * 0.015), close, volume: 100 + rand() * 900 });
    price = close;
  }
  return out;
}

const SCRIPT = `
import json, math, sys
sys.path.insert(0, sys.argv[1])
import williams, smc
candles = json.load(open(sys.argv[2], encoding="utf-8"))
o = [k["open"] for k in candles]; h = [k["high"] for k in candles]; l = [k["low"] for k in candles]; c = [k["close"] for k in candles]
def clean(x):
    if isinstance(x, float) and x != x: return None
    if isinstance(x, list): return [clean(v) for v in x]
    if isinstance(x, dict): return {k: clean(v) for k, v in x.items()}
    return x
w = williams.compute(h, l, c)
wise = williams.wise_men(o, h, l, c, w)
s = smc.compute(o, h, l, c)
out = {"w": {k: w[k] for k in ("jaw", "teeth", "lips", "ao", "ac", "zone", "aoDir", "acDir", "state", "fractals")}, "wise": wise, "smc": s}
print(json.dumps(clean(out)))
`;

const tests = [];
const test = (name, run) => tests.push([name, run]);
const num = (x) => (Number.isNaN(x) ? null : x);

for (const [seed, n] of [[3, 1500], [17, 3000]]) {
  test(`velas al azar ${seed} (${n}): Williams y SMC dan lo mismo en Python`, () => {
    const candles = randomCandles(n, seed);
    const dir = mkdtempSync(join(tmpdir(), 'wsmc-'));
    const file = join(dir, 'velas.json');
    writeFileSync(file, JSON.stringify(candles));
    let py;
    try {
      py = JSON.parse(execFileSync(backendPython(), ['-B', '-c', SCRIPT, BACKEND, file], { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const bars = barsOf(candles);
    const js = computeWilliams(bars);
    for (const key of ['jaw', 'teeth', 'lips', 'ao', 'ac', 'zone']) {
      const a = [...js[key]].map(num);
      assert.deepEqual(a, py.w[key], `${key}`);
    }
    for (const key of ['aoDir', 'acDir', 'state']) assert.deepEqual([...js[key]], py.w[key], key);
    assert.deepEqual(js.fractals, py.w.fractals, 'fractales');
    // Sabios 1 y 2: la vela de la señal, la entrada y el stop. El 3.º: el fractal, su nivel y la vela que lo pasa
    const core12 = (s) => [s.wise, s.dir, s.index, s.entry, s.stop];
    assert.deepEqual(js.signals.filter(s => s.wise < 3).map(core12), py.wise.filter(s => s.wise < 3).map(core12), 'sabios 1 y 2');
    const core3 = (s) => [s.dir, s.fractal, s.entry, s.wise === 3 && s.hit !== undefined ? s.hit : s.index];
    const js3 = js.signals.filter(s => s.wise === 3).map(core3).sort((a, b) => a[3] - b[3] || a[0] - b[0]);
    const py3 = py.wise.filter(s => s.wise === 3).map(core3).sort((a, b) => a[3] - b[3] || a[0] - b[0]);
    assert.deepEqual(js3, py3, 'sabio 3');
    const smc = computeSmc(bars);
    assert.deepEqual(smc.breaks, py.smc.breaks, 'rupturas');
    const ob = (x) => [x.scope, x.dir, x.index, x.top, x.bottom, x.known, x.touched, x.half, x.broken, x.breakerTouched, x.breakerEnd];
    assert.deepEqual(smc.obs.map(ob), py.smc.obs.map(ob), 'order blocks');
    const eq = (x) => [x.dir, x.first, x.index, x.level, x.known, x.swept, x.reclaimed];
    assert.deepEqual(smc.equals.map(eq), py.smc.equals.map(eq), 'iguales');
    for (const key of ['top', 'bottom']) assert.deepEqual([...smc[key]].map(num), py.smc[key], key);
    assert.deepEqual([...smc.bias], py.smc.bias, 'tendencia');
    console.log(`     ${js.signals.length} señales de los sabios, ${smc.breaks.length} rupturas, ${smc.obs.length} OB, ${smc.equals.length} iguales`);
  });
}

let failed = 0;
for (const [name, run] of tests) {
  try {
    await run();
    console.log(`ok  ${name}`);
  } catch (error) {
    failed++;
    console.error(`FALLA  ${name}\n${error.stack}`);
  }
}
console.log(`\n${tests.length - failed} de ${tests.length} pruebas pasaron`);
process.exit(failed ? 1 : 0);
